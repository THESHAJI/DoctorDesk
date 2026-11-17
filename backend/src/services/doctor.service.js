const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const { DoctorProfile, DoctorCertificate, User, sequelize } = require('../models');
const { DOCTOR_STATUS, ROLES } = require('../config/constants');
const { CERTIFICATE_UPLOAD_DIR } = require('../config/upload.config');
const ApiError = require('../utils/ApiError');

class DoctorService {
  /**
   * Helper: Resolves and verifies that a target file path resides strictly
   * within CERTIFICATE_UPLOAD_DIR with canonical realpath protection.
   * Defends against path traversal and symlink escapes.
   */
  static verifySafeFilePath(targetPath) {
    const baseDir = path.resolve(CERTIFICATE_UPLOAD_DIR);
    const resolvedPath = path.resolve(targetPath);

    // 1. Lexical containment check using path.relative
    const relative = path.relative(baseDir, resolvedPath);
    const isInside = !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);

    if (!isInside) {
      throw new ApiError(403, 'Access denied: Invalid file path traversal attempt');
    }

    // 2. Canonical realpath check (if file exists on disk)
    if (fs.existsSync(resolvedPath)) {
      const realBase = fs.realpathSync(baseDir);
      const realTarget = fs.realpathSync(resolvedPath);
      const realRelative = path.relative(realBase, realTarget);
      const isRealInside =
        !!realRelative && !realRelative.startsWith('..') && !path.isAbsolute(realRelative);

      if (!isRealInside) {
        throw new ApiError(403, 'Access denied: Symbolic link escape detected');
      }
    }

    return resolvedPath;
  }

  /**
   * Helper: Format certificate output to exclude physical filesystem paths
   */
  static formatCertificate(cert) {
    const json = typeof cert.toJSON === 'function' ? cert.toJSON() : cert;
    const { file_path, ...safeCert } = json;
    return safeCert;
  }

  /**
   * Retrieve currently authenticated doctor's full profile
   */
  static async getMyProfile(userId) {
    const doctorProfile = await DoctorProfile.findOne({
      where: { user_id: userId },
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'email', 'phone'],
        },
        {
          model: DoctorCertificate,
          as: 'certificates',
          attributes: ['id', 'original_name', 'mime_type', 'file_size', 'created_at'],
        },
      ],
    });

    if (!doctorProfile) {
      throw new ApiError(404, 'Doctor profile not found for this user account');
    }

    return doctorProfile.toJSON();
  }

  /**
   * Update doctor self-service profile attributes
   * Allowed: specialization, qualification, consultation_fee, bio
   * Forbidden: status, approved_by, approved_at, rejection_reason, suspension_reason
   */
  static async updateMyProfile(userId, updateData) {
    const doctorProfile = await DoctorProfile.findOne({
      where: { user_id: userId },
    });

    if (!doctorProfile) {
      throw new ApiError(404, 'Doctor profile not found');
    }

    const payload = {};
    if (updateData.specialization !== undefined) {
      payload.specialization = updateData.specialization.trim();
    }
    if (updateData.qualification !== undefined) {
      payload.qualification = updateData.qualification.trim();
    }
    if (updateData.consultationFee !== undefined) {
      payload.consultation_fee = parseFloat(updateData.consultationFee);
    }
    if (updateData.bio !== undefined) {
      payload.bio = updateData.bio ? updateData.bio.trim() : null;
    }

    await doctorProfile.update(payload);

    return DoctorService.getMyProfile(userId);
  }

  /**
   * Upload and register a new certificate document
   * Handles database failure with automatic physical file cleanup.
   */
  static async uploadCertificate(userId, file) {
    const doctorProfile = await DoctorProfile.findOne({
      where: { user_id: userId },
    });

    if (!doctorProfile) {
      // Remove disk file if profile not found
      if (fs.existsSync(file.path)) {
        await fs.promises.unlink(file.path).catch(() => {});
      }
      throw new ApiError(404, 'Doctor profile not found. Please complete profile registration.');
    }

    try {
      const certificate = await DoctorCertificate.create({
        doctor_profile_id: doctorProfile.id,
        file_name: file.filename,
        original_name: file.originalname,
        file_path: file.path,
        mime_type: file.verifiedMimeType || file.mimetype,
        file_size: file.size,
      });

      return DoctorService.formatCertificate(certificate);
    } catch (dbError) {
      // Automatic physical file cleanup on database failure
      if (fs.existsSync(file.path)) {
        await fs.promises.unlink(file.path).catch(() => {});
      }
      throw new ApiError(500, `Failed to save certificate record: ${dbError.message}`);
    }
  }

  /**
   * Secure certificate download / retrieval
   * Authorizes owner doctor or admin. Verifies safe canonical path.
   */
  static async getCertificateForDownload(userId, userRole, certificateId) {
    const certificate = await DoctorCertificate.findByPk(certificateId, {
      include: [
        {
          model: DoctorProfile,
          as: 'doctorProfile',
          attributes: ['id', 'user_id'],
        },
      ],
    });

    if (!certificate) {
      throw new ApiError(404, 'Certificate not found');
    }

    // Authorization check: Only the owning doctor or an admin can access
    const isOwner = certificate.doctorProfile && certificate.doctorProfile.user_id === userId;
    const isAdmin = userRole === ROLES.ADMIN;

    if (!isOwner && !isAdmin) {
      throw new ApiError(403, 'Forbidden. You do not have permission to access this certificate.');
    }

    // Canonical containment check
    const safePath = DoctorService.verifySafeFilePath(certificate.file_path);

    if (!fs.existsSync(safePath)) {
      throw new ApiError(404, 'Certificate file not found on disk storage.');
    }

    return {
      filePath: safePath,
      originalName: certificate.original_name,
      mimeType: certificate.mime_type,
    };
  }

  /**
   * Delete a certificate
   * Transactional removal: ensures both database record and physical file are handled safely.
   */
  static async deleteCertificate(userId, certificateId) {
    const certificate = await DoctorCertificate.findByPk(certificateId, {
      include: [
        {
          model: DoctorProfile,
          as: 'doctorProfile',
          attributes: ['id', 'user_id'],
        },
      ],
    });

    if (!certificate) {
      throw new ApiError(404, 'Certificate not found');
    }

    // Only the owning doctor can delete their certificate
    if (certificate.doctorProfile.user_id !== userId) {
      throw new ApiError(403, 'Forbidden. You cannot delete certificates belonging to another doctor.');
    }

    const diskPath = certificate.file_path;

    // Remove DB record first
    await certificate.destroy();

    // Remove physical file from disk safely
    try {
      if (fs.existsSync(diskPath)) {
        await fs.promises.unlink(diskPath);
      }
    } catch (fsErr) {
      console.error(`Warning: Certificate file deletion failed for ${diskPath}:`, fsErr.message);
      // DB record is already removed; log and proceed cleanly
    }

    return { id: certificateId, message: 'Certificate deleted successfully' };
  }

  /**
   * Public doctor directory listing (Patient & Public Facing)
   * Strictly filters by status: 'approved' and projects only safe public fields.
   */
  static async getPublicDoctors(queryParams = {}) {
    const page = Math.max(1, parseInt(queryParams.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(queryParams.limit, 10) || 10));
    const offset = (page - 1) * limit;

    const where = {
      status: DOCTOR_STATUS.APPROVED, // Strictly approved doctors only
    };

    if (queryParams.specialization) {
      where.specialization = {
        [Op.iLike || Op.like]: `%${queryParams.specialization.trim()}%`,
      };
    }

    const userWhere = {};
    if (queryParams.search) {
      userWhere.name = {
        [Op.iLike || Op.like]: `%${queryParams.search.trim()}%`,
      };
    }

    const { count, rows } = await DoctorProfile.findAndCountAll({
      where,
      limit,
      offset,
      order: [['id', 'ASC']],
      attributes: ['id', 'specialization', 'qualification', 'consultation_fee', 'bio'],
      include: [
        {
          model: User,
          as: 'user',
          where: Object.keys(userWhere).length > 0 ? userWhere : undefined,
          attributes: ['id', 'name'], // Never expose email, phone, or password_hash
        },
      ],
    });

    return {
      doctors: rows.map((r) => r.toJSON()),
      pagination: {
        totalItems: count,
        totalPages: Math.ceil(count / limit),
        currentPage: page,
        limit,
      },
    };
  }

  /**
   * Public single doctor detail
   * Strictly requires status: 'approved'
   */
  static async getPublicDoctorById(doctorId) {
    const doctor = await DoctorProfile.findOne({
      where: {
        id: doctorId,
        status: DOCTOR_STATUS.APPROVED,
      },
      attributes: ['id', 'specialization', 'qualification', 'consultation_fee', 'bio'],
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name'],
        },
      ],
    });

    if (!doctor) {
      throw new ApiError(404, 'Approved doctor not found with the requested ID');
    }

    return doctor.toJSON();
  }
}

module.exports = DoctorService;
