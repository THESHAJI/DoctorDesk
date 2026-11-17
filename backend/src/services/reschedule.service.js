const { Op } = require('sequelize');
const {
  AvailabilitySlot,
  DoctorProfile,
  Appointment,
  RescheduleRequest,
  Notification,
  sequelize,
} = require('../models');
const {
  APPOINTMENT_STATUS,
  DOCTOR_STATUS,
  SLOT_STATUS,
  RESCHEDULE_STATUS,
  NOTIFICATION_TYPES,
  ROLES,
} = require('../config/constants');
const { isSlotInPast, getAppointmentStartTimestamp } = require('../utils/timezone');
const ApiError = require('../utils/ApiError');
const NotificationService = require('./notification.service');

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

class RescheduleService {
  /**
   * Helper: Identifies transient PostgreSQL deadlock or serialization errors
   * eligible for transaction retry.
   *
   * @param {Error} err
   * @returns {boolean}
   */
  static isTransientPostgresError(err) {
    const code = err.original?.code || err.parent?.code || err.code;
    return code === '40P01' || code === '40001';
  }

  /**
   * Step 1: Patient Requests a Reschedule
   *
   * Workflow:
   * 1. Pre-read appointment, verify patient ownership FIRST.
   * 2. Validate appointment status === 'booked'.
   * 3. Validate 24-hour restriction in Asia/Kolkata.
   * 4. Check for existing pending reschedule request (reject duplicates).
   * 5. Find the next available future slot for the same doctor.
   * 6. Create RescheduleRequest with status 'pending'.
   *    The suggested slot remains 'available' until confirmed.
   *
   * @param {number} userId - Authenticated patient user ID
   * @param {number} appointmentId - Appointment to reschedule
   * @param {string} [reason] - Optional reschedule reason
   * @returns {Promise<object>}
   */
  static async requestReschedule(userId, appointmentId, reason) {
    const maxRetries = 2;
    let attempts = 0;

    while (attempts <= maxRetries) {
      try {
        return await sequelize.transaction(async (t) => {
          // Lock Level 3: Appointment (Parent levels 1 & 2 skipped per global hierarchy rule)
          const appointment = await Appointment.findByPk(appointmentId, {
            lock: t.LOCK.UPDATE,
            transaction: t,
          });

          if (!appointment) {
            throw new ApiError(404, 'Appointment not found');
          }

          // Step 5: Revalidate appointment ownership under the lock (Information Leakage Defense)
          if (appointment.patient_id !== userId) {
            throw new ApiError(403, 'Forbidden. You do not have permission to reschedule this appointment.');
          }

          // Step 5: Revalidate appointment status under the lock
          if (appointment.status !== APPOINTMENT_STATUS.BOOKED) {
            if (appointment.status === APPOINTMENT_STATUS.COMPLETED) {
              throw new ApiError(400, 'Cannot reschedule an appointment that is already marked as completed.');
            }
            if (appointment.status === APPOINTMENT_STATUS.CANCELLED) {
              throw new ApiError(400, 'Cannot reschedule an appointment that has been cancelled.');
            }
            if (appointment.status === APPOINTMENT_STATUS.NO_SHOW) {
              throw new ApiError(400, 'Cannot reschedule an appointment marked as no-show.');
            }
            if (appointment.status === APPOINTMENT_STATUS.RESCHEDULED) {
              throw new ApiError(400, 'Cannot reschedule an appointment that has already been rescheduled. Please manage the new appointment.');
            }
            throw new ApiError(400, `Cannot reschedule an appointment with status '${appointment.status}'.`);
          }

          // Fetch associated slot (eager-loaded or queried via PK)
          const slot =
            appointment.slot ||
            (await AvailabilitySlot.findByPk(appointment.slot_id, {
              transaction: t,
            }));

          if (!slot) {
            throw new ApiError(404, 'Associated availability slot not found');
          }

          // 24-hour restriction in Asia/Kolkata
          const appointmentStartMs = getAppointmentStartTimestamp(slot.slot_date, slot.start_time);
          const nowMs = Date.now();

          if (appointmentStartMs <= nowMs) {
            throw new ApiError(400, 'Cannot reschedule an appointment whose start time has already passed.');
          }

          if (appointmentStartMs - nowMs < TWENTY_FOUR_HOURS_MS) {
            throw new ApiError(400, 'Appointments cannot be rescheduled within 24 hours of start time.');
          }

          // Step 6: Check for an existing pending request inside the transaction (Lock Level 4)
          const existingPending = await RescheduleRequest.findOne({
            where: {
              appointment_id: appointment.id,
              status: RESCHEDULE_STATUS.PENDING,
            },
            lock: t.LOCK.UPDATE,
            transaction: t,
          });

          if (existingPending) {
            throw new ApiError(409, 'A pending reschedule request already exists for this appointment. Please confirm or reject it first.');
          }

          // Find next available future slot for the same doctor
          const suggestedSlot = await AvailabilitySlot.findOne({
            where: {
              doctor_profile_id: slot.doctor_profile_id,
              status: SLOT_STATUS.AVAILABLE,
              id: { [Op.ne]: slot.id },
            },
            order: [
              ['slot_date', 'ASC'],
              ['start_time', 'ASC'],
            ],
            transaction: t,
          });

          if (!suggestedSlot) {
            throw new ApiError(404, 'No alternative available slots found for this doctor.');
          }

          // Verify the suggested slot is in the future
          if (isSlotInPast(suggestedSlot.slot_date, suggestedSlot.start_time)) {
            throw new ApiError(404, 'No alternative available slots found for this doctor.');
          }

          // Step 7: Create the pending request inside the same transaction
          const trimmedReason = reason ? reason.trim() : null;
          const rescheduleRequest = await RescheduleRequest.create(
            {
              appointment_id: appointment.id,
              requested_by: userId,
              suggested_slot_id: suggestedSlot.id,
              status: RESCHEDULE_STATUS.PENDING,
              reason: trimmedReason,
            },
            { transaction: t }
          );

          return {
            rescheduleRequestId: rescheduleRequest.id,
            appointmentId: appointment.id,
            status: rescheduleRequest.status,
            suggestedSlot: {
              id: suggestedSlot.id,
              slot_date: suggestedSlot.slot_date,
              start_time: suggestedSlot.start_time,
              end_time: suggestedSlot.end_time,
            },
          };
        });
      } catch (err) {
        // Step 8: Handle PostgreSQL unique violation code 23505 as HTTP 409
        if (
          err.name === 'SequelizeUniqueConstraintError' ||
          err.original?.code === '23505' ||
          err.parent?.code === '23505' ||
          err.code === '23505'
        ) {
          throw new ApiError(409, 'A pending reschedule request already exists for this appointment.');
        }

        // Retry only approved deadlock and serialization errors
        if (RescheduleService.isTransientPostgresError(err) && attempts < maxRetries) {
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 50 * attempts));
          continue;
        }

        throw err;
      }
    }
  }

  /**
   * Doctor proposes the next available slot. The existing patient-only
   * confirmation endpoint remains the sole path that commits the reschedule.
   */
  static async proposeDoctorReschedule(doctorUserId, appointmentId, reason) {
    const preRead = await Appointment.findByPk(appointmentId);
    if (!preRead) throw new ApiError(404, 'Appointment not found');

    return sequelize.transaction(async (t) => {
      const doctorProfile = await DoctorProfile.findByPk(preRead.doctor_profile_id, {
        lock: t.LOCK.UPDATE,
        transaction: t,
      });
      if (!doctorProfile || doctorProfile.user_id !== doctorUserId) {
        throw new ApiError(403, 'Only the assigned doctor can propose a new appointment time');
      }
      if (doctorProfile.status !== DOCTOR_STATUS.APPROVED) {
        throw new ApiError(403, 'Only approved doctors can propose a new appointment time');
      }

      const oldSlot = await AvailabilitySlot.findByPk(preRead.slot_id, {
        lock: t.LOCK.UPDATE,
        transaction: t,
      });
      if (!oldSlot) throw new ApiError(404, 'Associated availability slot not found');

      const appointment = await Appointment.findByPk(appointmentId, {
        lock: t.LOCK.UPDATE,
        transaction: t,
      });
      if (
        !appointment ||
        appointment.doctor_profile_id !== doctorProfile.id ||
        appointment.slot_id !== oldSlot.id
      ) {
        throw new ApiError(409, 'Appointment relationship changed. Please retry.');
      }
      if (appointment.status !== APPOINTMENT_STATUS.BOOKED || oldSlot.status !== SLOT_STATUS.BOOKED) {
        throw new ApiError(409, 'Only a booked appointment can be rescheduled');
      }

      const startMs = getAppointmentStartTimestamp(oldSlot.slot_date, oldSlot.start_time);
      if (startMs <= Date.now()) {
        throw new ApiError(400, 'Cannot reschedule an appointment whose start time has already passed.');
      }
      if (startMs - Date.now() < TWENTY_FOUR_HOURS_MS) {
        throw new ApiError(400, 'Appointments cannot be rescheduled within 24 hours of start time.');
      }

      const existingRequest = await RescheduleRequest.findOne({
        where: { appointment_id: appointment.id, status: RESCHEDULE_STATUS.PENDING },
        lock: t.LOCK.UPDATE,
        transaction: t,
      });
      if (existingRequest) {
        throw new ApiError(409, 'A pending reschedule suggestion already exists for this appointment.');
      }

      const alternatives = await AvailabilitySlot.findAll({
        where: {
          doctor_profile_id: doctorProfile.id,
          status: SLOT_STATUS.AVAILABLE,
          id: { [Op.ne]: oldSlot.id },
        },
        order: [['slot_date', 'ASC'], ['start_time', 'ASC']],
        transaction: t,
      });
      const suggestedSlot = alternatives.find(
        (slot) => !isSlotInPast(slot.slot_date, slot.start_time)
      );
      if (!suggestedSlot) {
        throw new ApiError(404, 'No alternative available slots found for this doctor.');
      }

      const request = await RescheduleRequest.create({
        appointment_id: appointment.id,
        requested_by: doctorUserId,
        suggested_slot_id: suggestedSlot.id,
        status: RESCHEDULE_STATUS.PENDING,
        reason: reason.trim(),
      }, { transaction: t });

      await Notification.create({
        user_id: appointment.patient_id,
        appointment_id: appointment.id,
        type: NOTIFICATION_TYPES.RESCHEDULED,
        title: 'Doctor Suggested a New Appointment Time',
        message: `Your doctor suggested ${suggestedSlot.slot_date} at ${suggestedSlot.start_time}. Confirm or decline this suggestion in your appointments.`,
        is_read: false,
        is_sent: true,
        sent_at: new Date(),
      }, { transaction: t });

      return {
        rescheduleRequestId: request.id,
        appointmentId: appointment.id,
        status: request.status,
        requiresPatientConfirmation: true,
        suggestedSlot: {
          id: suggestedSlot.id,
          slot_date: suggestedSlot.slot_date,
          start_time: suggestedSlot.start_time,
          end_time: suggestedSlot.end_time,
        },
      };
    });
  }

  /**
   * Get Pending Reschedule Suggestion
   *
   * @param {number} userId - Authenticated patient user ID
   * @param {number} appointmentId - Appointment to inspect
   * @returns {Promise<object>}
   */
  static async getSuggestion(userId, appointmentId) {
    const appointment = await Appointment.findByPk(appointmentId);
    if (!appointment) {
      throw new ApiError(404, 'Appointment not found');
    }

    // Ownership authorization FIRST
    if (appointment.patient_id !== userId) {
      throw new ApiError(403, 'Forbidden. You do not have permission to view this reschedule suggestion.');
    }

    const pendingRequest = await RescheduleRequest.findOne({
      where: {
        appointment_id: appointmentId,
        status: RESCHEDULE_STATUS.PENDING,
      },
      include: [
        {
          model: AvailabilitySlot,
          as: 'suggestedSlot',
          attributes: ['id', 'slot_date', 'start_time', 'end_time', 'status'],
        },
      ],
    });

    if (!pendingRequest) {
      throw new ApiError(404, 'No pending reschedule request found for this appointment.');
    }

    const suggestedSlot = pendingRequest.suggestedSlot;

    return {
      rescheduleRequestId: pendingRequest.id,
      appointmentId: pendingRequest.appointment_id,
      status: pendingRequest.status,
      reason: pendingRequest.reason,
      suggestedSlot: suggestedSlot
        ? {
            id: suggestedSlot.id,
            slot_date: suggestedSlot.slot_date,
            start_time: suggestedSlot.start_time,
            end_time: suggestedSlot.end_time,
            isStillAvailable: suggestedSlot.status === SLOT_STATUS.AVAILABLE,
          }
        : null,
    };
  }

  /**
   * Step 2: Patient Confirms Reschedule
   *
   * Concurrency-Safe Atomic Transaction:
   * 1. Pre-read appointment and pending RescheduleRequest.
   * 2. Verify patient ownership FIRST.
   * 3. Begin managed transaction (with deadlock retry).
   * 4. Lock DoctorProfile (Level 1).
   * 5. Lock both slots in ascending PK order (Level 2a, 2b).
   * 6. Lock Appointment (Level 3).
   * 7. Lock RescheduleRequest (Level 4).
   * 8. Revalidate all state under lock.
   * 9. Atomic mutations: old slot → available, new slot → booked,
   *    original appointment → rescheduled, create new appointment,
   *    update request → confirmed, create doctor notification.
   * 10. Commit and return safe projection.
   *
   * @param {number} userId - Authenticated patient user ID
   * @param {number} appointmentId - Appointment to reschedule
   * @returns {Promise<object>}
   */
  static async confirmReschedule(userId, appointmentId) {
    // Step 1: Pre-read appointment and pending request
    const preReadAppt = await Appointment.findByPk(appointmentId);
    if (!preReadAppt) {
      throw new ApiError(404, 'Appointment not found');
    }

    // OWNERSHIP AUTHORIZATION FIRST
    if (preReadAppt.patient_id !== userId) {
      throw new ApiError(403, 'Forbidden. You do not have permission to confirm this reschedule.');
    }

    const preReadRequest = await RescheduleRequest.findOne({
      where: {
        appointment_id: appointmentId,
        status: RESCHEDULE_STATUS.PENDING,
      },
    });

    if (!preReadRequest) {
      throw new ApiError(404, 'No pending reschedule request found for this appointment.');
    }

    const preReadDocId = preReadAppt.doctor_profile_id;
    const oldSlotId = preReadAppt.slot_id;
    const newSlotId = preReadRequest.suggested_slot_id;

    if (!newSlotId) {
      throw new ApiError(400, 'Reschedule request has no suggested slot.');
    }

    // Deadlock and serialization failure retry wrapper (maximum 2 retries)
    const maxRetries = 2;
    let attempts = 0;

    while (attempts <= maxRetries) {
      try {
        const txResult = await sequelize.transaction(async (t) => {
          // Lock Level 1: DoctorProfile
          const doctorProfile = await DoctorProfile.findByPk(preReadDocId, {
            lock: t.LOCK.UPDATE,
            transaction: t,
          });

          if (!doctorProfile) {
            throw new ApiError(404, 'Associated doctor profile not found');
          }

          // Lock Level 2a & 2b: Both AvailabilitySlots in ascending PK order
          const firstSlotId = Math.min(oldSlotId, newSlotId);
          const secondSlotId = Math.max(oldSlotId, newSlotId);

          const firstSlot = await AvailabilitySlot.findByPk(firstSlotId, {
            lock: t.LOCK.UPDATE,
            transaction: t,
          });

          const secondSlot = await AvailabilitySlot.findByPk(secondSlotId, {
            lock: t.LOCK.UPDATE,
            transaction: t,
          });

          if (!firstSlot || !secondSlot) {
            throw new ApiError(404, 'One or both availability slots not found');
          }

          // Assign correct references regardless of PK order
          const oldSlot = firstSlot.id === oldSlotId ? firstSlot : secondSlot;
          const newSlot = firstSlot.id === newSlotId ? firstSlot : secondSlot;

          // Lock Level 3: Appointment
          const appointment = await Appointment.findByPk(appointmentId, {
            lock: t.LOCK.UPDATE,
            transaction: t,
          });

          if (!appointment) {
            throw new ApiError(404, 'Appointment not found');
          }

          // Lock Level 4: RescheduleRequest
          const rescheduleRequest = await RescheduleRequest.findByPk(preReadRequest.id, {
            lock: t.LOCK.UPDATE,
            transaction: t,
          });

          if (!rescheduleRequest || rescheduleRequest.appointment_id !== appointmentId) {
            throw new ApiError(404, 'Reschedule request not found for this appointment.');
          }

          // Handle the case where request status has already changed safely
          if (rescheduleRequest.status !== RESCHEDULE_STATUS.PENDING) {
            throw new ApiError(
              409,
              `Reschedule request is no longer pending (current status: '${rescheduleRequest.status}').`
            );
          }

          // Revalidation under lock
          if (appointment.status !== APPOINTMENT_STATUS.BOOKED) {
            throw new ApiError(409, 'Appointment is no longer in booked status. Cannot confirm reschedule.');
          }

          if (oldSlot.status !== SLOT_STATUS.BOOKED) {
            throw new ApiError(409, 'Original slot is no longer in booked status. Cannot confirm reschedule.');
          }

          // Check if suggested slot was claimed by another patient
          if (newSlot.status !== SLOT_STATUS.AVAILABLE) {
            // Mark request as expired inside the transaction and commit safely
            await rescheduleRequest.update(
              { status: RESCHEDULE_STATUS.EXPIRED, responded_at: new Date() },
              { transaction: t }
            );
            return {
              conflict: true,
              message:
                'The suggested slot is no longer available. It was booked by another patient. Please request a new reschedule suggestion.',
            };
          }

          // Validate new slot is not in the past
          if (isSlotInPast(newSlot.slot_date, newSlot.start_time)) {
            await rescheduleRequest.update(
              { status: RESCHEDULE_STATUS.EXPIRED, responded_at: new Date() },
              { transaction: t }
            );
            return {
              conflict: true,
              message: 'The suggested slot has passed. Please request a new reschedule suggestion.',
            };
          }

          // Validate original appointment is still >= 24 hours from start time
          const appointmentStartMs = getAppointmentStartTimestamp(oldSlot.slot_date, oldSlot.start_time);
          const nowMs = Date.now();

          if (appointmentStartMs <= nowMs) {
            throw new ApiError(400, 'Cannot reschedule an appointment whose start time has already passed.');
          }

          if (appointmentStartMs - nowMs < TWENTY_FOUR_HOURS_MS) {
            throw new ApiError(400, 'Appointments cannot be rescheduled within 24 hours of start time.');
          }

          // ===== ATOMIC MUTATIONS =====

          // 1. Release old slot
          await oldSlot.update(
            { status: SLOT_STATUS.AVAILABLE },
            { transaction: t }
          );

          // 2. Claim new slot
          await newSlot.update(
            { status: SLOT_STATUS.BOOKED },
            { transaction: t }
          );

          // 3. Mark original appointment as rescheduled (preserve history)
          await appointment.update(
            { status: APPOINTMENT_STATUS.RESCHEDULED },
            { transaction: t }
          );

          // 4. Create new appointment with forwarded fee snapshot
          const newAppointment = await Appointment.create(
            {
              patient_id: appointment.patient_id,
              doctor_profile_id: appointment.doctor_profile_id,
              slot_id: newSlot.id,
              status: APPOINTMENT_STATUS.BOOKED,
              consultation_fee: appointment.consultation_fee,
              commission_amount: appointment.commission_amount,
              total_fee: appointment.total_fee,
              commission_type: appointment.commission_type,
              commission_value: appointment.commission_value,
              booked_at: new Date(),
            },
            { transaction: t }
          );

          // 5. Update reschedule request
          await rescheduleRequest.update(
            { status: RESCHEDULE_STATUS.CONFIRMED, responded_at: new Date() },
            { transaction: t }
          );

          // 6. Notify doctor
          await Notification.create(
            {
              user_id: doctorProfile.user_id,
              appointment_id: newAppointment.id,
              type: NOTIFICATION_TYPES.RESCHEDULED,
              title: 'Appointment Rescheduled',
              message: `Appointment originally scheduled for ${oldSlot.slot_date} at ${oldSlot.start_time} has been rescheduled to ${newSlot.slot_date} at ${newSlot.start_time}.`,
              is_read: false,
              is_sent: true,
              sent_at: new Date(),
            },
            { transaction: t }
          );

          // 7. Invalidate old appointment's pending reminders
          await NotificationService.invalidatePendingReminders(appointment.id, t);

          // 8. Pre-schedule new reminders for rescheduled appointment
          await NotificationService.scheduleRemindersForAppointment(
            newAppointment.id,
            newSlot,
            appointment.patient_id,
            t
          );

          // Safe projection
          return {
            success: true,
            data: {
              originalAppointmentId: appointment.id,
              newAppointmentId: newAppointment.id,
              rescheduleRequestId: rescheduleRequest.id,
              status: RESCHEDULE_STATUS.CONFIRMED,
              newSlot: {
                id: newSlot.id,
                slot_date: newSlot.slot_date,
                start_time: newSlot.start_time,
                end_time: newSlot.end_time,
              },
            },
          };
        });

        // After the transaction successfully commits, convert conflict result to HTTP 409 ApiError
        if (txResult.conflict) {
          throw new ApiError(409, txResult.message);
        }

        return txResult.data;
      } catch (err) {
        // Retry only approved deadlock and serialization errors
        if (RescheduleService.isTransientPostgresError(err) && attempts < maxRetries) {
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 50 * attempts));
          continue;
        }

        throw err;
      }
    }
  }

  /**
   * Patient Rejects Reschedule Suggestion
   *
   * @param {number} userId - Authenticated patient user ID
   * @param {number} appointmentId - Appointment ID
   * @returns {Promise<object>}
   */
  static async rejectReschedule(userId, appointmentId) {
    const appointment = await Appointment.findByPk(appointmentId);
    if (!appointment) {
      throw new ApiError(404, 'Appointment not found');
    }

    // Ownership authorization FIRST
    if (appointment.patient_id !== userId) {
      throw new ApiError(403, 'Forbidden. You do not have permission to reject this reschedule.');
    }

    return await sequelize.transaction(async (t) => {
      const rescheduleRequest = await RescheduleRequest.findOne({
        where: {
          appointment_id: appointmentId,
          status: RESCHEDULE_STATUS.PENDING,
        },
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      if (!rescheduleRequest) {
        throw new ApiError(404, 'No pending reschedule request found for this appointment.');
      }

      // Verify it is still pending under lock (concurrent confirmation guard)
      if (rescheduleRequest.status !== RESCHEDULE_STATUS.PENDING) {
        throw new ApiError(409, 'Reschedule request is no longer pending.');
      }

      await rescheduleRequest.update(
        { status: RESCHEDULE_STATUS.REJECTED, responded_at: new Date() },
        { transaction: t }
      );

      return {
        rescheduleRequestId: rescheduleRequest.id,
        appointmentId: rescheduleRequest.appointment_id,
        status: RESCHEDULE_STATUS.REJECTED,
      };
    });
  }
}

module.exports = RescheduleService;
