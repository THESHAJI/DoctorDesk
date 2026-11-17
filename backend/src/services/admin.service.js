const path = require('path');
const fs = require('fs');
const { Op, fn, col } = require('sequelize');
const {
  DoctorProfile,
  DoctorCertificate,
  User,
  Appointment,
  AvailabilitySlot,
  AppSetting,
  sequelize,
} = require('../models');
const {
  DOCTOR_STATUS,
  ROLES,
  APPOINTMENT_STATUS,
  PAGINATION,
  COMMISSION_TYPE,
} = require('../config/constants');
const { LOGO_UPLOAD_DIR } = require('../config/upload.config');
const ApiError = require('../utils/ApiError');

class AdminService {
  /**
   * List doctor applications across all statuses with optional filtering and pagination
   */
  static async getDoctorApplications(queryParams = {}) {
    const page = Math.max(1, parseInt(queryParams.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(queryParams.limit, 10) || 10));
    const offset = (page - 1) * limit;

    const where = {};
    if (queryParams.status) {
      const validStatuses = Object.values(DOCTOR_STATUS);
      if (!validStatuses.includes(queryParams.status)) {
        throw new ApiError(
          400,
          `Invalid status filter. Allowed values: ${validStatuses.join(', ')}`
        );
      }
      where.status = queryParams.status;
    }

    const { count, rows } = await DoctorProfile.findAndCountAll({
      where,
      limit,
      offset,
      order: [['created_at', 'DESC']],
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'email', 'phone', 'is_active'],
        },
        {
          model: DoctorCertificate,
          as: 'certificates',
          attributes: ['id', 'original_name', 'mime_type', 'file_size', 'created_at'],
        },
      ],
    });

    return {
      applications: rows.map((r) => r.toJSON()),
      pagination: {
        totalItems: count,
        totalPages: Math.ceil(count / limit),
        currentPage: page,
        limit,
      },
    };
  }

  /**
   * Get complete details of a single doctor application
   */
  static async getDoctorApplicationById(doctorProfileId) {
    const doctor = await DoctorProfile.findByPk(doctorProfileId, {
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'email', 'phone', 'is_active', 'created_at'],
        },
        {
          model: DoctorCertificate,
          as: 'certificates',
          attributes: ['id', 'original_name', 'mime_type', 'file_size', 'created_at'],
        },
        {
          model: User,
          as: 'approver',
          attributes: ['id', 'name', 'email'],
        },
      ],
    });

    if (!doctor) {
      throw new ApiError(404, 'Doctor application not found');
    }

    return doctor.toJSON();
  }

  /**
   * Approve Doctor Profile
   * Transactional state transition with pessimistic row lock.
   * Allowed from: PENDING, SUSPENDED
   */
  static async approveDoctor(adminId, doctorProfileId) {
    return await sequelize.transaction(async (t) => {
      const doctor = await DoctorProfile.findByPk(doctorProfileId, {
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      if (!doctor) {
        throw new ApiError(404, 'Doctor profile not found');
      }

      if (doctor.status === DOCTOR_STATUS.APPROVED) {
        return {
          doctor: doctor.toJSON(),
          message: 'Doctor is already approved',
        };
      }

      const now = new Date();
      await doctor.update(
        {
          status: DOCTOR_STATUS.APPROVED,
          approved_by: adminId,
          approved_at: now,
          reviewed_by: adminId,
          reviewed_at: now,
          rejection_reason: null, // Clear past rejection if re-approved
          suspension_reason: null, // Clear past suspension if reinstated
        },
        { transaction: t }
      );

      return {
        doctor: doctor.toJSON(),
        message: 'Doctor profile approved successfully',
      };
    });
  }

  /**
   * Reject Doctor Profile
   * Transactional state transition with pessimistic row lock.
   * Allowed from: PENDING
   * Forbidden from: APPROVED (must suspend instead)
   */
  static async rejectDoctor(adminId, doctorProfileId, reason) {
    return await sequelize.transaction(async (t) => {
      const doctor = await DoctorProfile.findByPk(doctorProfileId, {
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      if (!doctor) {
        throw new ApiError(404, 'Doctor profile not found');
      }

      if (doctor.status === DOCTOR_STATUS.APPROVED) {
        throw new ApiError(
          400,
          'Cannot reject an already approved doctor. Use the suspend action instead.'
        );
      }

      if (doctor.status === DOCTOR_STATUS.REJECTED) {
        return {
          doctor: doctor.toJSON(),
          message: 'Doctor is already rejected',
        };
      }

      const now = new Date();
      await doctor.update(
        {
          status: DOCTOR_STATUS.REJECTED,
          rejection_reason: reason.trim(),
          reviewed_by: adminId,
          reviewed_at: now,
        },
        { transaction: t }
      );

      return {
        doctor: doctor.toJSON(),
        message: 'Doctor profile rejected successfully',
      };
    });
  }

  /**
   * Suspend Doctor Profile
   * Transactional state transition with pessimistic row lock.
   * Allowed from: APPROVED
   * Forbidden from: PENDING, REJECTED
   */
  static async suspendDoctor(adminId, doctorProfileId, reason) {
    return await sequelize.transaction(async (t) => {
      const doctor = await DoctorProfile.findByPk(doctorProfileId, {
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      if (!doctor) {
        throw new ApiError(404, 'Doctor profile not found');
      }

      if (doctor.status === DOCTOR_STATUS.SUSPENDED) {
        return {
          doctor: doctor.toJSON(),
          message: 'Doctor is already suspended',
        };
      }

      if (doctor.status !== DOCTOR_STATUS.APPROVED) {
        throw new ApiError(
          400,
          `Cannot suspend doctor with status '${doctor.status}'. Only approved doctors can be suspended.`
        );
      }

      const now = new Date();
      await doctor.update(
        {
          status: DOCTOR_STATUS.SUSPENDED,
          suspension_reason: reason.trim(),
          reviewed_by: adminId,
          reviewed_at: now,
        },
        { transaction: t }
      );

      return {
        doctor: doctor.toJSON(),
        message: 'Doctor profile suspended successfully',
      };
    });
  }

  /**
   * Dashboard statistics and revenue aggregates
   */
  static async getDashboardStats() {
    const [
      totalUsers,
      patientCount,
      doctorCount,
      adminCount,
      activeUsers,
      inactiveUsers,
      totalDoctors,
      pendingDoctors,
      approvedDoctors,
      rejectedDoctors,
      suspendedDoctors,
      totalAppointments,
      bookedAppointments,
      completedAppointments,
      cancelledAppointments,
      rescheduledAppointments,
      noShowAppointments,
    ] = await Promise.all([
      User.count(),
      User.count({ where: { role: ROLES.PATIENT } }),
      User.count({ where: { role: ROLES.DOCTOR } }),
      User.count({ where: { role: ROLES.ADMIN } }),
      User.count({ where: { is_active: true } }),
      User.count({ where: { is_active: false } }),
      DoctorProfile.count(),
      DoctorProfile.count({ where: { status: DOCTOR_STATUS.PENDING } }),
      DoctorProfile.count({ where: { status: DOCTOR_STATUS.APPROVED } }),
      DoctorProfile.count({ where: { status: DOCTOR_STATUS.REJECTED } }),
      DoctorProfile.count({ where: { status: DOCTOR_STATUS.SUSPENDED } }),
      Appointment.count(),
      Appointment.count({ where: { status: APPOINTMENT_STATUS.BOOKED } }),
      Appointment.count({ where: { status: APPOINTMENT_STATUS.COMPLETED } }),
      Appointment.count({ where: { status: APPOINTMENT_STATUS.CANCELLED } }),
      Appointment.count({ where: { status: APPOINTMENT_STATUS.RESCHEDULED } }),
      Appointment.count({ where: { status: APPOINTMENT_STATUS.NO_SHOW } }),
    ]);

    const completedRevenue = await Appointment.findAll({
      where: { status: APPOINTMENT_STATUS.COMPLETED },
      attributes: [
        [fn('SUM', col('consultation_fee')), 'total_consultation_volume'],
        [fn('SUM', col('commission_amount')), 'total_commission_earned'],
      ],
      raw: true,
    });

    const revenueRow = completedRevenue[0] || {};
    const totalConsultationVolume = parseFloat(revenueRow.total_consultation_volume || 0);
    const totalCommissionEarned = parseFloat(revenueRow.total_commission_earned || 0);
    const totalDoctorPayout = totalConsultationVolume - totalCommissionEarned;

    return {
      users: {
        total: totalUsers,
        patients: patientCount,
        doctors: doctorCount,
        admins: adminCount,
        active: activeUsers,
        inactive: inactiveUsers,
      },
      doctors: {
        total: totalDoctors,
        pending: pendingDoctors,
        approved: approvedDoctors,
        rejected: rejectedDoctors,
        suspended: suspendedDoctors,
      },
      appointments: {
        total: totalAppointments,
        booked: bookedAppointments,
        completed: completedAppointments,
        cancelled: cancelledAppointments,
        rescheduled: rescheduledAppointments,
        no_show: noShowAppointments,
      },
      revenue: {
        total_consultation_volume: Number(totalConsultationVolume.toFixed(2)),
        total_commission_earned: Number(totalCommissionEarned.toFixed(2)),
        total_doctor_payout: Number(totalDoctorPayout.toFixed(2)),
      },
    };
  }

  /**
   * Paginated user listing with role, is_active, and search filters
   */
  static async getUsers(queryParams = {}) {
    const page = Math.max(1, parseInt(queryParams.page, 10) || PAGINATION.DEFAULT_PAGE);
    const limit = Math.min(
      PAGINATION.MAX_LIMIT,
      Math.max(1, parseInt(queryParams.limit, 10) || PAGINATION.DEFAULT_LIMIT)
    );
    const offset = (page - 1) * limit;

    const where = {};
    if (queryParams.role) {
      where.role = queryParams.role;
    }
    if (queryParams.is_active !== undefined) {
      where.is_active = queryParams.is_active === 'true' || queryParams.is_active === true;
    }
    if (queryParams.search) {
      const term = `%${queryParams.search.trim()}%`;
      where[Op.or] = [
        { name: { [Op.iLike]: term } },
        { email: { [Op.iLike]: term } },
        { phone: { [Op.iLike]: term } },
      ];
    }

    const { count, rows } = await User.findAndCountAll({
      where,
      limit,
      offset,
      order: [['created_at', 'DESC'], ['id', 'DESC']],
      attributes: ['id', 'name', 'email', 'phone', 'role', 'is_active', 'created_at'],
      include: [
        {
          model: DoctorProfile,
          as: 'doctorProfile',
          attributes: ['id', 'specialization', 'qualification', 'consultation_fee', 'status'],
        },
      ],
    });

    return {
      users: rows.map((u) => u.toJSON()),
      pagination: {
        totalItems: count,
        totalPages: Math.ceil(count / limit),
        currentPage: page,
        limit,
      },
    };
  }

  /**
   * Update user active status with self-deactivation and deadlock-free last-admin guards
   */
  static async updateUserStatus(adminId, targetUserId, isActive) {
    if (parseInt(adminId, 10) === parseInt(targetUserId, 10) && !isActive) {
      throw new ApiError(400, 'Administrators cannot deactivate their own account');
    }

    return await sequelize.transaction(async (t) => {
      // 1. Read target user without a row lock first to inspect its current role
      const initialTarget = await User.findByPk(targetUserId, {
        transaction: t,
      });

      if (!initialTarget) {
        throw new ApiError(404, 'User not found');
      }

      let userToUpdate = null;

      // 2. Admin deactivation branch
      if (initialTarget.role === ROLES.ADMIN && !isActive) {
        // Lock ALL currently active admin rows in strict ascending ID order.
        // Do not lock the target separately beforehand to eliminate lock inversion deadlocks.
        const activeAdmins = await User.findAll({
          where: {
            role: ROLES.ADMIN,
            is_active: true,
          },
          order: [['id', 'ASC']],
          lock: t.LOCK.UPDATE,
          transaction: t,
        });

        // Revalidate target presence in the locked active-admin set
        userToUpdate = activeAdmins.find(
          (admin) => admin.id === parseInt(targetUserId, 10)
        );

        // If target was not found in locked active-admin set, verify concurrent state change
        if (!userToUpdate) {
          const refreshedTarget = await User.findByPk(targetUserId, {
            lock: t.LOCK.UPDATE,
            transaction: t,
          });

          if (!refreshedTarget) {
            throw new ApiError(404, 'User not found');
          }

          if (refreshedTarget.role !== ROLES.ADMIN) {
            throw new ApiError(409, 'User role changed concurrently during status update');
          }

          if (!refreshedTarget.is_active) {
            return {
              user: refreshedTarget.toJSON(),
              message: 'User account is already deactivated',
            };
          }

          userToUpdate = refreshedTarget;
        }

        // Reject if only one active admin remains
        if (activeAdmins.length <= 1) {
          throw new ApiError(400, 'Cannot deactivate the last active administrator');
        }
      } else {
        // 3. Non-admin target OR user activation branch
        // Lock target user directly and revalidate current state
        userToUpdate = await User.findByPk(targetUserId, {
          lock: t.LOCK.UPDATE,
          transaction: t,
        });

        if (!userToUpdate) {
          throw new ApiError(404, 'User not found');
        }

        // If target role concurrently changed to ADMIN during deactivation attempt
        if (userToUpdate.role === ROLES.ADMIN && !isActive) {
          throw new ApiError(409, 'User role changed concurrently to admin during status update');
        }
      }

      await userToUpdate.update({ is_active: isActive }, { transaction: t });

      return {
        user: userToUpdate.toJSON(),
        message: `User account ${isActive ? 'activated' : 'deactivated'} successfully`,
      };
    });
  }

  /**
   * Global appointment monitoring with slot date and created_at range filters
   */
  static async getAppointments(queryParams = {}) {
    const page = Math.max(1, parseInt(queryParams.page, 10) || PAGINATION.DEFAULT_PAGE);
    const limit = Math.min(
      PAGINATION.MAX_LIMIT,
      Math.max(1, parseInt(queryParams.limit, 10) || PAGINATION.DEFAULT_LIMIT)
    );
    const offset = (page - 1) * limit;

    const where = {};
    if (queryParams.status) {
      where.status = queryParams.status;
    }
    if (queryParams.doctorId) {
      where.doctor_profile_id = parseInt(queryParams.doctorId, 10);
    }
    if (queryParams.patientId) {
      where.patient_id = parseInt(queryParams.patientId, 10);
    }

    // Filter created_at on appointments
    if (queryParams.createdFrom || queryParams.createdTo) {
      where.created_at = {};
      if (queryParams.createdFrom) {
        where.created_at[Op.gte] = new Date(`${queryParams.createdFrom}T00:00:00.000Z`);
      }
      if (queryParams.createdTo) {
        where.created_at[Op.lte] = new Date(`${queryParams.createdTo}T23:59:59.999Z`);
      }
    }

    // Filter scheduled date on AvailabilitySlot
    const slotWhere = {};
    if (queryParams.startDate) {
      slotWhere.slot_date = slotWhere.slot_date || {};
      slotWhere.slot_date[Op.gte] = queryParams.startDate;
    }
    if (queryParams.endDate) {
      slotWhere.slot_date = slotWhere.slot_date || {};
      slotWhere.slot_date[Op.lte] = queryParams.endDate;
    }
    const hasSlotFilter = Object.keys(slotWhere).length > 0;

    const { count, rows } = await Appointment.findAndCountAll({
      where,
      limit,
      offset,
      order: [['created_at', 'DESC'], ['id', 'DESC']],
      include: [
        {
          model: User,
          as: 'patient',
          attributes: ['id', 'name', 'email', 'phone'],
        },
        {
          model: DoctorProfile,
          as: 'doctorProfile',
          attributes: ['id', 'specialization', 'qualification', 'consultation_fee', 'status'],
          include: [
            {
              model: User,
              as: 'user',
              attributes: ['id', 'name', 'email'],
            },
          ],
        },
        {
          model: AvailabilitySlot,
          as: 'slot',
          attributes: ['id', 'slot_date', 'start_time', 'end_time', 'status'],
          where: hasSlotFilter ? slotWhere : undefined,
          required: hasSlotFilter,
        },
      ],
    });

    return {
      appointments: rows.map((row) => {
        const appointment = row.toJSON();
        return {
          ...appointment,
          doctor_payout_amount: Number(
            (Number(appointment.consultation_fee) - Number(appointment.commission_amount)).toFixed(2)
          ),
        };
      }),
      pagination: {
        totalItems: count,
        totalPages: Math.ceil(count / limit),
        currentPage: page,
        limit,
      },
    };
  }

  /**
   * Retrieve platform commission settings
   */
  static async getCommissionSettings() {
    const typeSetting = await AppSetting.findOne({ where: { key: 'commission_type' } });
    const valueSetting = await AppSetting.findOne({ where: { key: 'commission_value' } });

    return {
      commissionType: typeSetting?.value || COMMISSION_TYPE.PERCENTAGE,
      commissionValue: parseFloat(valueSetting?.value || '10'),
    };
  }

  /**
   * Update platform commission settings (preserves existing appointment snapshots)
   */
  static async updateCommissionSettings(adminId, { commissionType, commissionValue }) {
    return await sequelize.transaction(async (t) => {
      await AppSetting.upsert(
        {
          key: 'commission_type',
          value: commissionType,
          description: 'Platform commission calculation type (percentage or fixed)',
        },
        { transaction: t }
      );

      await AppSetting.upsert(
        {
          key: 'commission_value',
          value: String(commissionValue),
          description: 'Platform commission numeric value',
        },
        { transaction: t }
      );

      return {
        commissionType,
        commissionValue: parseFloat(commissionValue),
        message: 'Commission settings updated successfully',
      };
    });
  }

  /**
   * Retrieve platform branding settings
   */
  static async getBrandingSettings() {
    const nameSetting = await AppSetting.findOne({ where: { key: 'app_name' } });
    const logoSetting = await AppSetting.findOne({ where: { key: 'app_logo' } });

    return {
      appName: nameSetting?.value || 'DoctorDesk',
      appLogo: logoSetting?.value || '',
    };
  }

  /**
   * Update platform branding settings and handle logo replacement cleanup
   */
  static async updateBrandingSettings(adminId, { appName, removeLogo }, file) {
    return await sequelize.transaction(async (t) => {
      const currentLogoSetting = await AppSetting.findOne({
        where: { key: 'app_logo' },
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      let newLogoValue = currentLogoSetting ? currentLogoSetting.value : '';
      let oldLogoToDelete = null;

      if (file) {
        const newFilename = path.basename(file.filename);
        if (newLogoValue && newLogoValue !== newFilename) {
          oldLogoToDelete = newLogoValue;
        }
        newLogoValue = newFilename;
      } else if (removeLogo === true || removeLogo === 'true') {
        if (newLogoValue) {
          oldLogoToDelete = newLogoValue;
        }
        newLogoValue = '';
      }

      if (appName) {
        await AppSetting.upsert(
          {
            key: 'app_name',
            value: appName.trim(),
            description: 'Application branding name',
          },
          { transaction: t }
        );
      }

      if (file || removeLogo !== undefined) {
        await AppSetting.upsert(
          {
            key: 'app_logo',
            value: newLogoValue,
            description: 'Application branding logo filename',
          },
          { transaction: t }
        );
      }

      // Safe asynchronous removal of superseded logo file
      if (oldLogoToDelete) {
        const safeOldName = path.basename(oldLogoToDelete);
        const oldFilePath = path.join(LOGO_UPLOAD_DIR, safeOldName);
        try {
          if (fs.existsSync(oldFilePath)) {
            await fs.promises.unlink(oldFilePath);
          }
        } catch (unlinkErr) {
          console.error(`Failed to delete replaced logo file ${oldFilePath}:`, unlinkErr.message);
        }
      }

      const updatedName = await AppSetting.findOne({ where: { key: 'app_name' }, transaction: t });
      const updatedLogo = await AppSetting.findOne({ where: { key: 'app_logo' }, transaction: t });

      return {
        appName: updatedName?.value || 'DoctorDesk',
        appLogo: updatedLogo?.value || '',
        message: 'Branding settings updated successfully',
      };
    });
  }

  /**
   * Get safe absolute file path for branding logo
   */
  static async getBrandingLogoPath() {
    const logoSetting = await AppSetting.findOne({ where: { key: 'app_logo' } });
    if (!logoSetting || !logoSetting.value) {
      return null;
    }
    const safeFilename = path.basename(logoSetting.value);
    const fullPath = path.join(LOGO_UPLOAD_DIR, safeFilename);
    if (!fs.existsSync(fullPath)) {
      return null;
    }
    return fullPath;
  }
}

module.exports = AdminService;
