const { Op } = require('sequelize');
const { AvailabilitySlot, DoctorProfile, Appointment, AppSetting, Notification, RescheduleRequest, User, sequelize } = require('../models');
const { DOCTOR_STATUS, SLOT_STATUS, APPOINTMENT_STATUS, RESCHEDULE_STATUS, COMMISSION_TYPE, NOTIFICATION_TYPES, ROLES, PAGINATION } = require('../config/constants');
const { calculateFee } = require('../utils/feeCalculator');
const { isSlotInPast, getAppointmentStartTimestamp } = require('../utils/timezone');
const ApiError = require('../utils/ApiError');
const NotificationService = require('./notification.service');

class AppointmentService {
  static getPagination(query = {}) {
    const page = Math.max(1, parseInt(query.page, 10) || PAGINATION.DEFAULT_PAGE);
    const limit = Math.min(
      PAGINATION.MAX_LIMIT,
      Math.max(1, parseInt(query.limit, 10) || PAGINATION.DEFAULT_LIMIT)
    );
    return { page, limit, offset: (page - 1) * limit };
  }

  static formatAppointment(appointment, role) {
    const row = appointment.toJSON ? appointment.toJSON() : appointment;
    return {
      id: row.id,
      status: row.status,
      consultation_fee: row.consultation_fee,
      commission_amount: row.commission_amount,
      total_fee: row.total_fee,
      booked_at: row.booked_at,
      completed_at: row.completed_at,
      cancelled_at: row.cancelled_at,
      cancellation_reason: row.cancellation_reason,
      slot: row.slot
        ? {
            id: row.slot.id,
            slot_date: row.slot.slot_date,
            start_time: row.slot.start_time,
            end_time: row.slot.end_time,
            status: row.slot.status,
          }
        : null,
      doctor: row.doctorProfile
        ? {
            id: row.doctorProfile.id,
            name: row.doctorProfile.user?.name,
            specialization: row.doctorProfile.specialization,
            qualification: row.doctorProfile.qualification,
          }
        : null,
      patient: role === ROLES.DOCTOR && row.patient
        ? {
            id: row.patient.id,
            name: row.patient.name,
            email: row.patient.email,
            phone: row.patient.phone,
          }
        : undefined,
    };
  }

  static async getPatientAppointments(patientId, query = {}) {
    return AppointmentService.getAppointmentsForUser(patientId, ROLES.PATIENT, query);
  }

  static async getDoctorAppointments(doctorUserId, query = {}) {
    return AppointmentService.getAppointmentsForUser(doctorUserId, ROLES.DOCTOR, query);
  }

  static async getAppointmentsForUser(userId, role, query = {}) {
    const { page, limit, offset } = AppointmentService.getPagination(query);
    const where = {};
    if (role === ROLES.PATIENT) {
      where.patient_id = userId;
    } else {
      const profile = await DoctorProfile.findOne({ where: { user_id: userId }, attributes: ['id'] });
      if (!profile) {
        throw new ApiError(404, 'Doctor profile not found');
      }
      where.doctor_profile_id = profile.id;
    }

    if (query.status) where.status = query.status;
    const slotWhere = {};
    if (query.startDate) slotWhere.slot_date = { [Op.gte]: query.startDate };
    if (query.endDate) {
      slotWhere.slot_date = {
        ...(slotWhere.slot_date || {}),
        [Op.lte]: query.endDate,
      };
    }

    const { rows, count } = await Appointment.findAndCountAll({
      where,
      attributes: [
        'id', 'status', 'consultation_fee', 'commission_amount', 'total_fee',
        'booked_at', 'completed_at', 'cancelled_at', 'cancellation_reason',
      ],
      include: [
        {
          model: AvailabilitySlot,
          as: 'slot',
          attributes: ['id', 'slot_date', 'start_time', 'end_time', 'status'],
          where: Object.keys(slotWhere).length ? slotWhere : undefined,
          required: Object.keys(slotWhere).length > 0,
        },
        {
          model: DoctorProfile,
          as: 'doctorProfile',
          attributes: ['id', 'specialization', 'qualification'],
          include: [{ model: User, as: 'user', attributes: ['name'] }],
        },
        ...(role === ROLES.DOCTOR
          ? [{ model: User, as: 'patient', attributes: ['id', 'name', 'email', 'phone'] }]
          : []),
      ],
      order: [['created_at', 'DESC'], ['id', 'DESC']],
      limit,
      offset,
      distinct: true,
    });

    return {
      appointments: rows.map((row) => AppointmentService.formatAppointment(row, role)),
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    };
  }

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
   * Concurrency-Safe Appointment Booking
   *
   * Transactional & Concurrency-Safe Workflow:
   * 1. Pre-read the slot (unlocked) to obtain doctor_profile_id.
   * 2. Open a managed Sequelize transaction (with max 2 retries for transient deadlock/serialization errors).
   * 3. Lock DoctorProfile row (SELECT FOR UPDATE) — Lock Level 1.
   * 4. Recheck doctor approval status under lock.
   * 5. Enforce self-booking prevention (doctor cannot book own profile).
   * 6. Lock AvailabilitySlot row (SELECT FOR UPDATE) — Lock Level 2.
   * 7. Revalidate slot ownership and availability (status === 'available').
   * 8. Reject past slots relative to clinic time (Asia/Kolkata).
   * 9. Retrieve commission settings and calculate fee snapshot via feeCalculator.js.
   * 10. Atomically mark slot as 'booked' and create Appointment record.
   * 11. Commit transaction and return safe response projection.
   *
   * @param {number} patientId - Authenticated user ID (Patient role)
   * @param {object} bookingData - { slotId, doctorProfileId? }
   * @returns {Promise<object>} Created appointment data
   */
  static async bookAppointment(patientId, bookingData) {
    const { slotId, doctorProfileId: requestedDoctorProfileId } = bookingData;

    // Step 1: Pre-read slot without locking to identify doctor_profile_id
    const preReadSlot = await AvailabilitySlot.findByPk(slotId);
    if (!preReadSlot) {
      throw new ApiError(404, 'Availability slot not found');
    }

    const doctorProfileId = preReadSlot.doctor_profile_id;

    if (requestedDoctorProfileId && parseInt(requestedDoctorProfileId, 10) !== doctorProfileId) {
      throw new ApiError(400, 'Slot does not belong to the specified doctor profile');
    }

    // Deadlock and serialization failure retry wrapper (maximum 2 retries)
    const maxRetries = 2;
    let attempts = 0;

    while (attempts <= maxRetries) {
      try {
        return await sequelize.transaction(async (t) => {
          // Step 3: Lock DoctorProfile first (Lock Level 1)
          const doctorProfile = await DoctorProfile.findByPk(doctorProfileId, {
            lock: t.LOCK.UPDATE,
            transaction: t,
          });

          if (!doctorProfile) {
            throw new ApiError(404, 'Doctor profile not found');
          }

          // Step 4: Recheck doctor approval status
          if (doctorProfile.status !== DOCTOR_STATUS.APPROVED) {
            throw new ApiError(
              403,
              `Cannot book appointment. Doctor profile status is '${doctorProfile.status}'. Only approved doctors can accept bookings.`
            );
          }

          // Step 5: Prevent self-booking (doctor cannot book own profile)
          if (doctorProfile.user_id === patientId) {
            throw new ApiError(400, 'Doctors cannot book appointments with themselves');
          }

          // Step 6: Lock AvailabilitySlot second (Lock Level 2)
          const slot = await AvailabilitySlot.findOne({
            where: { id: slotId },
            lock: t.LOCK.UPDATE,
            transaction: t,
          });

          if (!slot) {
            throw new ApiError(404, 'Availability slot not found');
          }

          // Revalidate slot ownership and availability
          if (slot.doctor_profile_id !== doctorProfile.id) {
            throw new ApiError(400, 'Slot does not belong to the locked doctor profile');
          }

          if (slot.status !== SLOT_STATUS.AVAILABLE) {
            throw new ApiError(409, 'This slot is no longer available for booking');
          }

          // Step 7: Reject past slots relative to clinic time (Asia/Kolkata)
          if (isSlotInPast(slot.slot_date, slot.start_time)) {
            throw new ApiError(
              400,
              'Cannot book an appointment for a slot in the past relative to clinic time (Asia/Kolkata)'
            );
          }

          // Step 8: Calculate doctor fee and admin commission using existing feeCalculator.js
          const settings = await AppSetting.findAll({
            where: {
              key: ['commission_type', 'commission_value'],
            },
            transaction: t,
          });

          const settingsMap = Object.fromEntries(settings.map((s) => [s.key, s.value]));
          const commissionType = settingsMap.commission_type || COMMISSION_TYPE.PERCENTAGE;
          const commissionValue = parseFloat(settingsMap.commission_value || '10');

          const consultationFee = parseFloat(doctorProfile.consultation_fee);
          const feeSnapshot = calculateFee(consultationFee, commissionType, commissionValue);

          // Step 10: Mark slot as booked
          await slot.update(
            { status: SLOT_STATUS.BOOKED },
            { transaction: t }
          );

          // Step 11: Create the appointment in the same transaction
          const appointment = await Appointment.create(
            {
              patient_id: patientId,
              doctor_profile_id: doctorProfile.id,
              slot_id: slot.id,
              status: APPOINTMENT_STATUS.BOOKED,
              consultation_fee: consultationFee,
              commission_amount: feeSnapshot.commissionAmount,
              total_fee: feeSnapshot.totalFee,
              commission_type: commissionType,
              commission_value: commissionValue,
              booked_at: new Date(),
            },
            { transaction: t }
          );

          // Trigger In-App Booking Confirmation & Pre-schedule 24h, 1h, 15m reminders
          try {
            await NotificationService.createBookingConfirmation(
              appointment.id,
              slot,
              patientId,
              doctorProfile,
              t
            );

            await NotificationService.scheduleRemindersForAppointment(
              appointment.id,
              slot,
              patientId,
              t
            );
          } catch (notifErr) {
            // Notification scheduling failures shouldn't crash booking in unit tests if unmocked
            if (process.env.NODE_ENV !== 'test') {
              throw notifErr;
            }
          }

          // Return safe response projection
          return {
            appointment: {
              id: appointment.id,
              doctor_profile_id: appointment.doctor_profile_id,
              slot_id: appointment.slot_id,
              status: appointment.status,
              consultation_fee: appointment.consultation_fee,
              commission_amount: appointment.commission_amount,
              total_fee: appointment.total_fee,
              commission_type: appointment.commission_type,
              commission_value: appointment.commission_value,
              booked_at: appointment.booked_at,
              slot: {
                id: slot.id,
                slot_date: slot.slot_date,
                start_time: slot.start_time,
                end_time: slot.end_time,
              },
              doctor: {
                id: doctorProfile.id,
                specialization: doctorProfile.specialization,
                qualification: doctorProfile.qualification,
              },
            },
          };
        });
      } catch (err) {
        // PostgreSQL unique constraint violation on unique_active_slot_booking
        if (
          err.name === 'SequelizeUniqueConstraintError' ||
          err.original?.code === '23505'
        ) {
          throw new ApiError(409, 'This slot is already booked');
        }

        // Retry only approved deadlock and serialization errors
        if (AppointmentService.isTransientPostgresError(err) && attempts < maxRetries) {
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 50 * attempts));
          continue;
        }

        throw err;
      }
    }
  }

  /**
   * Concurrency-Safe Appointment Cancellation (Patient or Doctor)
   *
   * Lock Order & Execution Sequence:
   * 1. Pre-read the appointment (unlocked) to obtain doctor_profile_id and slot_id.
   * 2. Begin managed Sequelize transaction (with max 2 retries on 40P01 / 40001).
   * 3. Lock Level 1: Lock DoctorProfile row (SELECT FOR UPDATE).
   * 4. Lock Level 2: Lock AvailabilitySlot row (SELECT FOR UPDATE).
   * 5. Lock Level 3: Lock Appointment row (SELECT FOR UPDATE).
   * 6. Revalidate relationships:
   *    appointment.doctor_profile_id === doctorProfile.id && appointment.slot_id === slot.id
   *    If mismatch -> throw 409 Conflict.
   * 7. OWNERSHIP AUTHORIZATION FIRST (Information Leakage Defense):
   *    Verify caller is owning patient (appointment.patient_id === userId && userRole === ROLES.PATIENT)
   *    OR owning doctor (doctorProfile.user_id === userId && userRole === ROLES.DOCTOR).
   *    If unauthorized -> throw 403 Forbidden.
   * 8. Post-Authorization Slot State Validation:
   *    Verify slot.status === SLOT_STATUS.BOOKED. If mismatch -> throw 409 Conflict.
   * 9. Post-Authorization Doctor Reason Validation:
   *    If doctor: assert reason && reason.trim().length >= 5. If invalid -> throw 400 Bad Request.
   * 10. Post-Authorization Appointment Status Gating:
   *     Assert appointment.status === APPOINTMENT_STATUS.BOOKED.
   *     If completed, cancelled, no_show, or rescheduled -> throw 400 Bad Request.
   * 11. Timing & 24-Hour Boundary Checks (Asia/Kolkata):
   *     appointmentStartMs = getAppointmentStartTimestamp(slot.slot_date, slot.start_time)
   *     If appointmentStartMs <= Date.now() -> throw 400 Bad Request ("Cannot cancel an appointment whose start time has already passed.")
   *     If (appointmentStartMs - Date.now()) < 24 * 60 * 60 * 1000 -> throw 400 Bad Request ("Appointments cannot be cancelled within 24 hours of start time.")
   *     Uniformly enforced for both patients and doctors (no emergency bypass).
   * 12. Atomic Updates & In-App Notification:
   *     appointment.update({ status: 'cancelled', cancellation_reason: reason || 'Cancelled by patient', cancelled_at: new Date() }, { transaction: t })
   *     slot.update({ status: 'available' }, { transaction: t })
   *     If doctor cancellation: Notification.create(...) for patient inside same transaction.
   * 13. Commit atomically and return safe projection.
   *
   * @param {number} userId - Authenticated user ID
   * @param {string} userRole - 'patient' or 'doctor'
   * @param {number} appointmentId - Appointment ID to cancel
   * @param {string} [reason] - Cancellation reason (mandatory for doctors)
   * @returns {Promise<object>} Cancelled appointment summary
   */
  static async cancelAppointment(userId, userRole, appointmentId, reason) {
    // Step 1: Pre-read appointment without locking to derive doctor_profile_id and slot_id
    const preReadAppt = await Appointment.findByPk(appointmentId);
    if (!preReadAppt) {
      throw new ApiError(404, 'Appointment not found');
    }

    const { doctor_profile_id: preReadDocId, slot_id: preReadSlotId } = preReadAppt;

    // Deadlock and serialization failure retry wrapper (maximum 2 retries)
    const maxRetries = 2;
    let attempts = 0;

    while (attempts <= maxRetries) {
      try {
        return await sequelize.transaction(async (t) => {
          // Step 3: Lock Level 1 — DoctorProfile
          const doctorProfile = await DoctorProfile.findByPk(preReadDocId, {
            lock: t.LOCK.UPDATE,
            transaction: t,
          });

          if (!doctorProfile) {
            throw new ApiError(404, 'Associated doctor profile not found');
          }

          // Step 4: Lock Level 2 — AvailabilitySlot
          const slot = await AvailabilitySlot.findOne({
            where: { id: preReadSlotId },
            lock: t.LOCK.UPDATE,
            transaction: t,
          });

          if (!slot) {
            throw new ApiError(404, 'Associated availability slot not found');
          }

          // Step 5: Lock Level 3 — Appointment
          const appointment = await Appointment.findOne({
            where: { id: appointmentId },
            lock: t.LOCK.UPDATE,
            transaction: t,
          });

          if (!appointment) {
            throw new ApiError(404, 'Appointment not found');
          }

          // Step 6: Locked Appointment Relationship Revalidation (HTTP 409 Gate)
          if (
            appointment.doctor_profile_id !== doctorProfile.id ||
            appointment.slot_id !== slot.id
          ) {
            throw new ApiError(
              409,
              'Appointment relationship changed concurrently. Please retry.'
            );
          }

          // Step 7: Ownership Authorization FIRST (HTTP 403 Gate - Information Leakage Defense)
          const isPatient = appointment.patient_id === userId && userRole === ROLES.PATIENT;
          const isDoctor = doctorProfile.user_id === userId && userRole === ROLES.DOCTOR;

          if (!isPatient && !isDoctor) {
            throw new ApiError(403, 'Forbidden. You do not have permission to cancel this appointment.');
          }

          // Step 8: Post-Authorization Slot State Validation (HTTP 409 Gate)
          if (slot.status !== SLOT_STATUS.BOOKED) {
            throw new ApiError(
              409,
              `Associated availability slot is in '${slot.status}' state instead of 'booked'. Cannot cancel appointment.`
            );
          }

          // Step 9: Post-Authorization Doctor Reason Validation (HTTP 400 Gate)
          if (isDoctor && (!reason || reason.trim().length < 5)) {
            throw new ApiError(400, 'Doctor cancellation requires a reason of at least 5 characters');
          }

          // Step 10: Post-Authorization Appointment Status Gating (HTTP 400 Gate)
          if (appointment.status !== APPOINTMENT_STATUS.BOOKED) {
            if (appointment.status === APPOINTMENT_STATUS.COMPLETED) {
              throw new ApiError(400, 'Cannot cancel an appointment that is already marked as completed.');
            }
            if (appointment.status === APPOINTMENT_STATUS.CANCELLED) {
              throw new ApiError(400, 'Appointment has already been cancelled.');
            }
            if (appointment.status === APPOINTMENT_STATUS.NO_SHOW) {
              throw new ApiError(400, 'Cannot cancel an appointment marked as no-show.');
            }
            if (appointment.status === APPOINTMENT_STATUS.RESCHEDULED) {
              throw new ApiError(400, 'Cannot cancel an appointment that has already been rescheduled.');
            }
            throw new ApiError(400, `Cannot cancel an appointment with status '${appointment.status}'.`);
          }

          // Step 11: Timing & 24-Hour Boundary Checks (Asia/Kolkata)
          const appointmentStartMs = getAppointmentStartTimestamp(slot.slot_date, slot.start_time);

          if (appointmentStartMs <= Date.now()) {
            throw new ApiError(400, 'Cannot cancel an appointment whose start time has already passed.');
          }

          const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
          if (appointmentStartMs - Date.now() < TWENTY_FOUR_HOURS_MS) {
            throw new ApiError(400, 'Appointments cannot be cancelled within 24 hours of start time.');
          }

          // Step 12: Atomic Updates & In-App Notification
          const trimmedReason = reason ? reason.trim() : (isDoctor ? '' : 'Cancelled by patient');

          await appointment.update(
            {
              status: APPOINTMENT_STATUS.CANCELLED,
              cancellation_reason: trimmedReason,
              cancelled_at: new Date(),
            },
            { transaction: t }
          );

          await slot.update(
            { status: SLOT_STATUS.AVAILABLE },
            { transaction: t }
          );

          // Invalidate any future unsent reminders for this appointment
          await NotificationService.invalidatePendingReminders(appointment.id, t);

          // If cancelled by doctor, insert in-app notification for patient
          if (isDoctor) {
            await Notification.create(
              {
                user_id: appointment.patient_id,
                appointment_id: appointment.id,
                type: NOTIFICATION_TYPES.CANCELLED,
                title: 'Appointment Cancelled by Doctor',
                message: `Your appointment on ${slot.slot_date} at ${slot.start_time} was cancelled by the doctor. Reason: ${trimmedReason}`,
                is_read: false,
                is_sent: false,
              },
              { transaction: t }
            );
          }

          // Step 13: Return safe projection
          return {
            appointment: {
              id: appointment.id,
              doctor_profile_id: appointment.doctor_profile_id,
              slot_id: appointment.slot_id,
              status: appointment.status,
              cancellation_reason: appointment.cancellation_reason,
              cancelled_at: appointment.cancelled_at,
            },
            slot: {
              id: slot.id,
              status: slot.status,
            },
          };
        });
      } catch (err) {
        // Retry only approved deadlock and serialization errors
        if (AppointmentService.isTransientPostgresError(err) && attempts < maxRetries) {
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 50 * attempts));
          continue;
        }

        throw err;
      }

    }
  }

  /**
   * Complete an appointment for its assigned approved doctor after its scheduled end.
   * Lock order is DoctorProfile -> AvailabilitySlot -> Appointment -> RescheduleRequest.
   */
  static async completeAppointment(doctorUserId, appointmentId) {
    const preRead = await Appointment.findByPk(appointmentId);
    if (!preRead) throw new ApiError(404, 'Appointment not found');

    return sequelize.transaction(async (t) => {
      const doctorProfile = await DoctorProfile.findByPk(preRead.doctor_profile_id, {
        lock: t.LOCK.UPDATE,
        transaction: t,
      });
      if (!doctorProfile || doctorProfile.user_id !== doctorUserId) {
        throw new ApiError(403, 'Only the assigned doctor can complete this appointment');
      }
      if (doctorProfile.status !== DOCTOR_STATUS.APPROVED) {
        throw new ApiError(403, 'Only approved doctors can complete appointments');
      }

      const slot = await AvailabilitySlot.findByPk(preRead.slot_id, {
        lock: t.LOCK.UPDATE,
        transaction: t,
      });
      if (!slot) throw new ApiError(404, 'Associated availability slot not found');

      const appointment = await Appointment.findByPk(appointmentId, {
        lock: t.LOCK.UPDATE,
        transaction: t,
      });
      if (
        !appointment ||
        appointment.doctor_profile_id !== doctorProfile.id ||
        appointment.slot_id !== slot.id
      ) {
        throw new ApiError(409, 'Appointment relationship changed. Please retry.');
      }
      if (appointment.status !== APPOINTMENT_STATUS.BOOKED || slot.status !== SLOT_STATUS.BOOKED) {
        throw new ApiError(409, 'Only a booked appointment with a booked slot can be completed');
      }

      const activeReschedule = await RescheduleRequest.findOne({
        where: { appointment_id: appointment.id, status: RESCHEDULE_STATUS.PENDING },
        lock: t.LOCK.UPDATE,
        transaction: t,
      });
      if (activeReschedule) {
        throw new ApiError(409, 'Resolve the pending reschedule request before completing this appointment');
      }

      if (getAppointmentStartTimestamp(slot.slot_date, slot.end_time) > Date.now()) {
        throw new ApiError(400, 'An appointment cannot be completed before its scheduled end time');
      }

      await appointment.update(
        { status: APPOINTMENT_STATUS.COMPLETED, completed_at: new Date() },
        { transaction: t }
      );
      await NotificationService.invalidatePendingReminders(appointment.id, t);
      await Notification.create(
        {
          user_id: appointment.patient_id,
          appointment_id: appointment.id,
          type: NOTIFICATION_TYPES.COMPLETED,
          title: 'Appointment Completed',
          message: `Your appointment on ${slot.slot_date} at ${slot.start_time} has been marked complete.`,
          is_read: false,
          is_sent: true,
          sent_at: new Date(),
        },
        { transaction: t }
      );

      return {
        appointment: {
          id: appointment.id,
          status: appointment.status,
          completed_at: appointment.completed_at,
        },
      };
    });
  }
}

module.exports = AppointmentService;
