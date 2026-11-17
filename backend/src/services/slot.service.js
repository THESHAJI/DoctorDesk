const { Op } = require('sequelize');
const { AvailabilitySlot, DoctorProfile, Appointment, sequelize } = require('../models');
const { DOCTOR_STATUS, SLOT_STATUS, APPOINTMENT_STATUS } = require('../config/constants');
const { isSlotInPast } = require('../utils/timezone');
const ApiError = require('../utils/ApiError');

class SlotService {
  /**
   * Helper: Normalize time strings to HH:MM:SS
   */
  static normalizeTime(timeStr) {
    if (!timeStr) return timeStr;
    const parts = timeStr.trim().split(':');
    if (parts.length === 2) {
      return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:00`;
    }
    if (parts.length === 3) {
      return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:${parts[2].padStart(2, '0')}`;
    }
    return timeStr;
  }

  /**
   * Helper: Convert HH:MM(:SS) to minutes from midnight
   */
  static timeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.trim().split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    return hours * 60 + minutes;
  }

  /**
   * Helper: Convert total minutes from midnight to HH:MM:SS
   */
  static minutesToTime(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
  }

  /**
   * Create a single availability slot for the authenticated doctor.
   *
   * Transactional & Concurrency-Safe Workflow:
   * 1. Begin managed transaction.
   * 2. Lock parent DoctorProfile row (SELECT FOR UPDATE) to serialize doctor mutations.
   * 3. Assert doctor ownership and status === 'approved'.
   * 4. Enforce strict single-calendar-day interval (startTime < endTime).
   * 5. Verify slot is not in the past relative to Asia/Kolkata clinic time.
   * 6. Check interval overlap under parent row lock (startTime < existingEnd && endTime > existingStart).
   * 7. Insert slot record with status 'available'.
   *
   * @param {number} userId - Authenticated doctor user ID
   * @param {object} slotData - { slotDate, startTime, endTime }
   * @returns {Promise<object>} Created AvailabilitySlot JSON
   */
  static async createSingleSlot(userId, slotData) {
    const { slotDate, startTime, endTime } = slotData;

    const normalizedStart = SlotService.normalizeTime(startTime);
    const normalizedEnd = SlotService.normalizeTime(endTime);

    // Validate single calendar day interval (overnight slots rejected)
    if (normalizedEnd <= normalizedStart) {
      throw new ApiError(
        422,
        'Slot end time must be later than start time and within the same calendar day (00:00 to 23:59).'
      );
    }

    // Validate slot is not in the past relative to clinic timezone
    if (isSlotInPast(slotDate, normalizedStart)) {
      throw new ApiError(
        422,
        'Cannot create availability slots in the past relative to clinic time (Asia/Kolkata).'
      );
    }

    return await sequelize.transaction(async (t) => {
      // 1. Lock parent DoctorProfile row (Pessimistic Row Lock: Level 1)
      const doctorProfile = await DoctorProfile.findOne({
        where: { user_id: userId },
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      if (!doctorProfile) {
        throw new ApiError(404, 'Doctor profile not found for this user account.');
      }

      // 2. Doctor Approval Verification under the row lock
      if (doctorProfile.status !== DOCTOR_STATUS.APPROVED) {
        throw new ApiError(
          403,
          `Cannot manage availability slots. Doctor profile status is '${doctorProfile.status}'. Only approved doctors can manage slots.`
        );
      }

      // 3. Range Overlap Check under the parent row lock
      const overlappingSlot = await AvailabilitySlot.findOne({
        where: {
          doctor_profile_id: doctorProfile.id,
          slot_date: slotDate,
          start_time: { [Op.lt]: normalizedEnd },
          end_time: { [Op.gt]: normalizedStart },
        },
        transaction: t,
      });

      if (overlappingSlot) {
        throw new ApiError(
          409,
          `Slot time ${startTime}-${endTime} overlaps with an existing availability slot (${overlappingSlot.start_time}-${overlappingSlot.end_time}) on ${slotDate}.`
        );
      }

      // 4. Create Availability Slot
      const newSlot = await AvailabilitySlot.create(
        {
          doctor_profile_id: doctorProfile.id,
          slot_date: slotDate,
          start_time: normalizedStart,
          end_time: normalizedEnd,
          status: SLOT_STATUS.AVAILABLE,
        },
        { transaction: t }
      );

      return newSlot.toJSON();
    });
  }

  /**
   * Bulk generate availability slots for a doctor on a single calendar day.
   *
   * Transactional & Concurrency-Safe Workflow:
   * 1. Validate start/end times and calculate total time window in minutes.
   * 2. Validate single calendar day (reject overnight windows where endTime <= startTime).
   * 3. Validate window divisibility by duration (totalMinutes % duration === 0).
   * 4. Enforce max 100 slots limit.
   * 5. Generate candidate slots in memory.
   * 6. Check that no candidate slot starts in the past (Asia/Kolkata timezone).
   * 7. Open managed transaction.
   * 8. Lock parent DoctorProfile (SELECT FOR UPDATE).
   * 9. Recheck doctor status === 'approved'.
   * 10. Check interval overlaps against existing slots under lock:
   *     Existing slot on same date where start_time < normalizedEnd AND end_time > normalizedStart.
   *     If ANY existing slot overlaps the requested window, reject entire batch with 409.
   * 11. Atomically insert all candidate slots via bulkCreate.
   *
   * @param {number} userId - Authenticated doctor user ID
   * @param {object} bulkData - { slotDate, startTime, endTime, duration }
   * @returns {Promise<{ count: number, slots: Array<object> }>}
   */
  static async createBulkSlots(userId, bulkData) {
    const { slotDate, startTime, endTime, duration } = bulkData;
    const durationNum = parseInt(duration, 10);

    const normalizedStart = SlotService.normalizeTime(startTime);
    const normalizedEnd = SlotService.normalizeTime(endTime);

    // Validate single calendar day interval (overnight windows rejected)
    if (normalizedEnd <= normalizedStart) {
      throw new ApiError(
        422,
        'Slot end time must be later than start time and within the same calendar day (00:00 to 23:59).'
      );
    }

    const startMinutes = SlotService.timeToMinutes(normalizedStart);
    const endMinutes = SlotService.timeToMinutes(normalizedEnd);
    const totalMinutes = endMinutes - startMinutes;

    // Check divisibility
    if (totalMinutes % durationNum !== 0) {
      throw new ApiError(
        422,
        `Total time window (${totalMinutes} minutes) must divide evenly by slot duration (${durationNum} minutes).`
      );
    }

    const slotCount = totalMinutes / durationNum;
    if (slotCount > 100) {
      throw new ApiError(
        422,
        `Bulk slot generation exceeds maximum limit of 100 slots (requested ${slotCount} slots).`
      );
    }

    // Generate candidate slots in memory
    const candidateSlots = [];
    for (let current = startMinutes; current < endMinutes; current += durationNum) {
      const slotStart = SlotService.minutesToTime(current);
      const slotEnd = SlotService.minutesToTime(current + durationNum);

      // Verify slot is not in the past relative to clinic timezone
      if (isSlotInPast(slotDate, slotStart)) {
        throw new ApiError(
          422,
          'Cannot create availability slots in the past relative to clinic time (Asia/Kolkata).'
        );
      }

      candidateSlots.push({
        slot_date: slotDate,
        start_time: slotStart,
        end_time: slotEnd,
        status: SLOT_STATUS.AVAILABLE,
      });
    }

    return await sequelize.transaction(async (t) => {
      // 1. Lock parent DoctorProfile row (Pessimistic Row Lock: Level 1)
      const doctorProfile = await DoctorProfile.findOne({
        where: { user_id: userId },
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      if (!doctorProfile) {
        throw new ApiError(404, 'Doctor profile not found for this user account.');
      }

      // 2. Doctor Approval Verification under the row lock
      if (doctorProfile.status !== DOCTOR_STATUS.APPROVED) {
        throw new ApiError(
          403,
          `Cannot manage availability slots. Doctor profile status is '${doctorProfile.status}'. Only approved doctors can manage slots.`
        );
      }

      // 3. Overlap Check under the parent row lock for the entire window
      const overlappingSlot = await AvailabilitySlot.findOne({
        where: {
          doctor_profile_id: doctorProfile.id,
          slot_date: slotDate,
          start_time: { [Op.lt]: normalizedEnd },
          end_time: { [Op.gt]: normalizedStart },
        },
        transaction: t,
      });

      if (overlappingSlot) {
        throw new ApiError(
          409,
          `Bulk slot generation conflict: existing slot (${overlappingSlot.start_time}-${overlappingSlot.end_time}) overlaps with the requested window (${startTime}-${endTime}) on ${slotDate}.`
        );
      }

      // 4. Atomically insert all slots
      const slotsToInsert = candidateSlots.map((slot) => ({
        ...slot,
        doctor_profile_id: doctorProfile.id,
      }));

      const createdSlots = await AvailabilitySlot.bulkCreate(slotsToInsert, {
        transaction: t,
      });

      return {
        count: createdSlots.length,
        slots: createdSlots.map((s) => (s.toJSON ? s.toJSON() : s)),
      };
    });
  }

  /**
   * List slots belonging to the authenticated doctor
   */
  static async getDoctorSlots(userId, query = {}) {
    const doctorProfile = await DoctorProfile.findOne({
      where: { user_id: userId },
    });

    if (!doctorProfile) {
      throw new ApiError(404, 'Doctor profile not found');
    }

    const where = {
      doctor_profile_id: doctorProfile.id,
    };

    if (query.slotDate) {
      where.slot_date = query.slotDate;
    }
    if (query.status) {
      where.status = query.status;
    }

    const slots = await AvailabilitySlot.findAll({
      where,
      order: [
        ['slot_date', 'ASC'],
        ['start_time', 'ASC'],
      ],
    });

    return slots.map((s) => s.toJSON());
  }

  /**
   * Get available future slots for an approved doctor (Public/Patient facing)
   */
  static async getDoctorAvailableSlots(doctorProfileId, query = {}) {
    const doctorProfile = await DoctorProfile.findByPk(doctorProfileId);
    if (!doctorProfile || doctorProfile.status !== DOCTOR_STATUS.APPROVED) {
      throw new ApiError(404, 'Doctor profile not found or not approved');
    }

    const where = {
      doctor_profile_id: doctorProfile.id,
      status: SLOT_STATUS.AVAILABLE,
    };

    if (query.date) {
      where.slot_date = query.date;
    }

    const slots = await AvailabilitySlot.findAll({
      where,
      order: [
        ['slot_date', 'ASC'],
        ['start_time', 'ASC'],
      ],
    });

    // Filter out slots that have already passed in Asia/Kolkata clinic time
    return slots
      .map((s) => (s.toJSON ? s.toJSON() : s))
      .filter((s) => !isSlotInPast(s.slot_date, s.start_time));
  }

  /**
   * Block an available slot (Doctor only).
   *
   * Transaction Workflow:
   * 1. Lock DoctorProfile (Level 1).
   * 2. Lock AvailabilitySlot (Level 2).
   * 3. Verify ownership.
   * 4. Reject if slot is currently booked or has active appointments.
   * 5. Update status to 'blocked'.
   *
   * @param {number} userId - Authenticated doctor user ID
   * @param {number} slotId - Slot to block
   * @returns {Promise<object>}
   */
  static async blockSlot(userId, slotId) {
    return await sequelize.transaction(async (t) => {
      // Lock Level 1: DoctorProfile
      const doctorProfile = await DoctorProfile.findOne({
        where: { user_id: userId },
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      if (!doctorProfile) {
        throw new ApiError(404, 'Doctor profile not found for this user account.');
      }

      if (doctorProfile.status !== DOCTOR_STATUS.APPROVED) {
        throw new ApiError(
          403,
          `Cannot manage availability slots. Doctor profile status is '${doctorProfile.status}'. Only approved doctors can manage slots.`
        );
      }

      // Lock Level 2: AvailabilitySlot
      const slot = await AvailabilitySlot.findByPk(slotId, {
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      if (!slot) {
        throw new ApiError(404, 'Availability slot not found.');
      }

      // Ownership check
      if (slot.doctor_profile_id !== doctorProfile.id) {
        throw new ApiError(403, 'You do not own this availability slot.');
      }

      // Already blocked — idempotent
      if (slot.status === SLOT_STATUS.BLOCKED) {
        return { id: slot.id, status: slot.status };
      }

      // Cannot block a booked slot
      if (slot.status === SLOT_STATUS.BOOKED) {
        throw new ApiError(400, 'Cannot block a currently booked slot.');
      }

      // Verify no active appointment references this slot
      const activeCount = await Appointment.count({
        where: {
          slot_id: slot.id,
          status: { [Op.in]: [APPOINTMENT_STATUS.BOOKED, APPOINTMENT_STATUS.COMPLETED] },
        },
        transaction: t,
      });

      if (activeCount > 0) {
        throw new ApiError(400, 'Cannot block a slot that has an active appointment.');
      }

      await slot.update({ status: SLOT_STATUS.BLOCKED }, { transaction: t });

      return { id: slot.id, status: slot.status };
    });
  }

  /**
   * Unblock a blocked slot (Doctor only).
   *
   * @param {number} userId - Authenticated doctor user ID
   * @param {number} slotId - Slot to unblock
   * @returns {Promise<object>}
   */
  static async unblockSlot(userId, slotId) {
    return await sequelize.transaction(async (t) => {
      // Lock Level 1: DoctorProfile
      const doctorProfile = await DoctorProfile.findOne({
        where: { user_id: userId },
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      if (!doctorProfile) {
        throw new ApiError(404, 'Doctor profile not found for this user account.');
      }

      if (doctorProfile.status !== DOCTOR_STATUS.APPROVED) {
        throw new ApiError(
          403,
          `Cannot manage availability slots. Doctor profile status is '${doctorProfile.status}'. Only approved doctors can manage slots.`
        );
      }

      // Lock Level 2: AvailabilitySlot
      const slot = await AvailabilitySlot.findByPk(slotId, {
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      if (!slot) {
        throw new ApiError(404, 'Availability slot not found.');
      }

      // Ownership check
      if (slot.doctor_profile_id !== doctorProfile.id) {
        throw new ApiError(403, 'You do not own this availability slot.');
      }

      if (slot.status !== SLOT_STATUS.BLOCKED) {
        throw new ApiError(400, 'Only blocked slots can be unblocked.');
      }

      // Cannot unblock a slot in the past
      if (isSlotInPast(slot.slot_date, slot.start_time)) {
        throw new ApiError(400, 'Cannot unblock a slot in the past.');
      }

      await slot.update({ status: SLOT_STATUS.AVAILABLE }, { transaction: t });

      return { id: slot.id, status: slot.status };
    });
  }

  /**
   * Safe-delete a slot (Doctor only).
   *
   * Historical Appointment Protection:
   * Slot deletion is rejected if ANY appointment record in history
   * references this slot_id (booked, cancelled, completed, no_show, rescheduled).
   *
   * @param {number} userId - Authenticated doctor user ID
   * @param {number} slotId - Slot to delete
   * @returns {Promise<object>}
   */
  static async deleteSlot(userId, slotId) {
    return await sequelize.transaction(async (t) => {
      // Lock Level 1: DoctorProfile
      const doctorProfile = await DoctorProfile.findOne({
        where: { user_id: userId },
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      if (!doctorProfile) {
        throw new ApiError(404, 'Doctor profile not found for this user account.');
      }

      if (doctorProfile.status !== DOCTOR_STATUS.APPROVED) {
        throw new ApiError(
          403,
          `Cannot manage availability slots. Doctor profile status is '${doctorProfile.status}'. Only approved doctors can manage slots.`
        );
      }

      // Lock Level 2: AvailabilitySlot
      const slot = await AvailabilitySlot.findByPk(slotId, {
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      if (!slot) {
        throw new ApiError(404, 'Availability slot not found.');
      }

      // Ownership check
      if (slot.doctor_profile_id !== doctorProfile.id) {
        throw new ApiError(403, 'You do not own this availability slot.');
      }

      // Cannot delete a currently booked slot
      if (slot.status === SLOT_STATUS.BOOKED) {
        throw new ApiError(400, 'Cannot delete a currently booked slot.');
      }

      // Historical Appointment Protection Check
      const historyCount = await Appointment.count({
        where: { slot_id: slot.id },
        transaction: t,
      });

      if (historyCount > 0) {
        throw new ApiError(
          400,
          'Cannot delete availability slot that has associated appointment history. You may block the slot instead to prevent new bookings.'
        );
      }

      const deletedId = slot.id;
      await slot.destroy({ transaction: t });

      return { id: deletedId };
    });
  }
}

module.exports = SlotService;
