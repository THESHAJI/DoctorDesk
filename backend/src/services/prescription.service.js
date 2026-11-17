const {
  Prescription,
  PrescriptionItem,
  Appointment,
  DoctorProfile,
  User,
  sequelize,
} = require('../models');
const {
  ROLES,
  DOCTOR_STATUS,
  APPOINTMENT_STATUS,
  PAGINATION,
} = require('../config/constants');
const ApiError = require('../utils/ApiError');

class PrescriptionService {
  /**
   * Helper: Identifies transient PostgreSQL deadlock or serialization errors
   */
  static isTransientPostgresError(err) {
    const code = err.original?.code || err.parent?.code || err.code;
    return code === '40P01' || code === '40001';
  }

  /**
   * Doctor: Create a prescription for an appointment.
   *
   * Business Rules:
   * 1. Doctor user must have an approved DoctorProfile.
   * 2. Appointment must belong to this doctor profile.
   * 3. Appointment status must be COMPLETED (never auto-completes).
   * 4. An appointment cannot already have a prescription (One-to-One, 409 Conflict).
   * 5. Atomically creates Prescription and bulk-creates PrescriptionItems in managed transaction.
   * 6. PostgreSQL 23505 unique constraint mapped to HTTP 409.
   */
  static async createPrescription(userId, data) {
    const { appointmentId, diagnosis, notes, items } = data;

    // Pre-check doctor profile
    const doctorProfile = await DoctorProfile.findOne({
      where: { user_id: userId },
    });

    if (!doctorProfile) {
      throw new ApiError(404, 'Doctor profile not found for this user');
    }

    if (doctorProfile.status !== DOCTOR_STATUS.APPROVED) {
      throw new ApiError(403, 'Only approved doctors can write prescriptions');
    }

    const maxRetries = 2;
    let attempts = 0;

    while (attempts <= maxRetries) {
      try {
        return await sequelize.transaction(async (t) => {
          // Lock appointment row to prevent race conditions
          const appointment = await Appointment.findByPk(appointmentId, {
            lock: t.LOCK.UPDATE,
            transaction: t,
          });

          if (!appointment) {
            throw new ApiError(404, 'Appointment not found');
          }

          // Ownership check
          if (appointment.doctor_profile_id !== doctorProfile.id) {
            throw new ApiError(
              403,
              'Forbidden. You can only create prescriptions for your own appointments.'
            );
          }

          // Must be completed
          if (appointment.status !== APPOINTMENT_STATUS.COMPLETED) {
            throw new ApiError(
              400,
              `Cannot create prescription for appointment with status '${appointment.status}'. Prescriptions can only be issued for completed appointments.`
            );
          }

          // Check if prescription already exists
          const existingPrescription = await Prescription.findOne({
            where: { appointment_id: appointmentId },
            lock: t.LOCK.UPDATE,
            transaction: t,
          });

          if (existingPrescription) {
            throw new ApiError(
              409,
              'A prescription has already been created for this appointment.'
            );
          }

          // Create Prescription
          const prescription = await Prescription.create(
            {
              appointment_id: appointment.id,
              doctor_profile_id: doctorProfile.id,
              patient_id: appointment.patient_id,
              diagnosis: diagnosis ? diagnosis.trim() : null,
              notes: notes ? notes.trim() : null,
            },
            { transaction: t }
          );

          // Bulk create prescription items
          const itemsToInsert = items.map((item) => ({
            prescription_id: prescription.id,
            medicine_name: item.medicine_name.trim(),
            dosage: item.dosage.trim(),
            frequency: item.frequency.trim(),
            duration: item.duration.trim(),
            instructions: item.instructions ? item.instructions.trim() : null,
          }));

          const createdItems = await PrescriptionItem.bulkCreate(itemsToInsert, {
            transaction: t,
          });

          return {
            id: prescription.id,
            appointment_id: prescription.appointment_id,
            doctor_profile_id: prescription.doctor_profile_id,
            patient_id: prescription.patient_id,
            diagnosis: prescription.diagnosis,
            notes: prescription.notes,
            created_at: prescription.createdAt,
            items: createdItems.map((i) => ({
              id: i.id,
              medicine_name: i.medicine_name,
              dosage: i.dosage,
              frequency: i.frequency,
              duration: i.duration,
              instructions: i.instructions,
            })),
          };
        });
      } catch (err) {
        if (
          err.name === 'SequelizeUniqueConstraintError' ||
          err.original?.code === '23505' ||
          err.parent?.code === '23505' ||
          err.code === '23505'
        ) {
          throw new ApiError(
            409,
            'A prescription has already been created for this appointment.'
          );
        }

        if (PrescriptionService.isTransientPostgresError(err) && attempts < maxRetries) {
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 50 * attempts));
          continue;
        }

        throw err;
      }
    }
  }

  /**
   * Get single prescription by ID with strict ownership authorization
   */
  static async getPrescriptionById(userId, userRole, prescriptionId) {
    const prescription = await Prescription.findByPk(prescriptionId, {
      include: [
        {
          model: PrescriptionItem,
          as: 'items',
          attributes: ['id', 'medicine_name', 'dosage', 'frequency', 'duration', 'instructions'],
        },
        {
          model: User,
          as: 'patient',
          attributes: ['id', 'name', 'email', 'phone'],
        },
        {
          model: DoctorProfile,
          as: 'doctorProfile',
          attributes: ['id', 'user_id', 'specialization', 'qualification'],
          include: [
            {
              model: User,
              as: 'user',
              attributes: ['id', 'name'],
            },
          ],
        },
      ],
    });

    if (!prescription) {
      throw new ApiError(404, 'Prescription not found');
    }

    // Role-based authorization
    if (userRole === ROLES.PATIENT) {
      if (prescription.patient_id !== userId) {
        throw new ApiError(403, 'Forbidden. You do not have permission to view this prescription.');
      }
    } else if (userRole === ROLES.DOCTOR) {
      if (prescription.doctorProfile?.user_id !== userId) {
        throw new ApiError(403, 'Forbidden. You do not have permission to view this prescription.');
      }
    } else if (userRole !== ROLES.ADMIN) {
      throw new ApiError(403, 'Forbidden.');
    }

    return {
      id: prescription.id,
      appointment_id: prescription.appointment_id,
      diagnosis: prescription.diagnosis,
      notes: prescription.notes,
      created_at: prescription.createdAt,
      items: prescription.items || [],
      patient: prescription.patient
        ? {
            id: prescription.patient.id,
            name: prescription.patient.name,
            email: prescription.patient.email,
            phone: prescription.patient.phone,
          }
        : null,
      doctor: prescription.doctorProfile
        ? {
            id: prescription.doctorProfile.id,
            name: prescription.doctorProfile.user?.name,
            specialization: prescription.doctorProfile.specialization,
            qualification: prescription.doctorProfile.qualification,
          }
        : null,
    };
  }

  /**
   * Patient: List own prescriptions with pagination
   */
  static async getPatientPrescriptions(userId, query = {}) {
    const page = Math.max(1, parseInt(query.page, 10) || PAGINATION.DEFAULT_PAGE);
    const limit = Math.min(
      PAGINATION.MAX_LIMIT,
      Math.max(1, parseInt(query.limit, 10) || PAGINATION.DEFAULT_LIMIT)
    );
    const offset = (page - 1) * limit;

    const { rows: prescriptions, count: total } = await Prescription.findAndCountAll({
      where: { patient_id: userId },
      attributes: ['id', 'appointment_id', 'diagnosis', 'notes', 'createdAt'],
      include: [
        {
          model: PrescriptionItem,
          as: 'items',
          attributes: ['id', 'medicine_name', 'dosage', 'frequency', 'duration', 'instructions'],
        },
        {
          model: DoctorProfile,
          as: 'doctorProfile',
          attributes: ['id', 'specialization', 'qualification'],
          include: [
            {
              model: User,
              as: 'user',
              attributes: ['id', 'name'],
            },
          ],
        },
      ],
      order: [['created_at', 'DESC'], ['id', 'DESC']],
      limit,
      offset,
      distinct: true,
    });

    return {
      prescriptions: prescriptions.map((p) => ({
        id: p.id,
        appointment_id: p.appointment_id,
        diagnosis: p.diagnosis,
        notes: p.notes,
        created_at: p.createdAt,
        items: p.items || [],
        doctor: p.doctorProfile
          ? {
              id: p.doctorProfile.id,
              name: p.doctorProfile.user?.name,
              specialization: p.doctorProfile.specialization,
              qualification: p.doctorProfile.qualification,
            }
          : null,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Doctor: List own prescriptions with pagination
   */
  static async getDoctorPrescriptions(userId, query = {}) {
    const doctorProfile = await DoctorProfile.findOne({
      where: { user_id: userId },
    });

    if (!doctorProfile) {
      throw new ApiError(404, 'Doctor profile not found');
    }

    const page = Math.max(1, parseInt(query.page, 10) || PAGINATION.DEFAULT_PAGE);
    const limit = Math.min(
      PAGINATION.MAX_LIMIT,
      Math.max(1, parseInt(query.limit, 10) || PAGINATION.DEFAULT_LIMIT)
    );
    const offset = (page - 1) * limit;

    const { rows: prescriptions, count: total } = await Prescription.findAndCountAll({
      where: { doctor_profile_id: doctorProfile.id },
      attributes: ['id', 'appointment_id', 'diagnosis', 'notes', 'createdAt'],
      include: [
        {
          model: PrescriptionItem,
          as: 'items',
          attributes: ['id', 'medicine_name', 'dosage', 'frequency', 'duration', 'instructions'],
        },
        {
          model: User,
          as: 'patient',
          attributes: ['id', 'name', 'email', 'phone'],
        },
      ],
      order: [['created_at', 'DESC'], ['id', 'DESC']],
      limit,
      offset,
      distinct: true,
    });

    return {
      prescriptions: prescriptions.map((p) => ({
        id: p.id,
        appointment_id: p.appointment_id,
        diagnosis: p.diagnosis,
        notes: p.notes,
        created_at: p.createdAt,
        items: p.items || [],
        patient: p.patient
          ? {
              id: p.patient.id,
              name: p.patient.name,
              email: p.patient.email,
              phone: p.patient.phone,
            }
          : null,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

module.exports = PrescriptionService;
