const ApiError = require('../utils/ApiError');
const { DoctorProfile } = require('../models');
const { DOCTOR_STATUS, ROLES } = require('../config/constants');

/**
 * Middleware: requireApprovedDoctor
 *
 * Security Principle:
 * Never rely solely on doctor approval status in a static JWT. If an admin suspends
 * or rejects a doctor after their JWT was issued, relying on the token would allow
 * unauthorized access. This middleware always queries the database in real-time.
 */
const requireApprovedDoctor = async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== ROLES.DOCTOR) {
      return next(new ApiError(403, 'Access denied. Doctor access required.'));
    }

    // Always fetch fresh profile from the database
    const profile = await DoctorProfile.findOne({
      where: { user_id: req.user.id },
    });

    if (!profile) {
      return next(new ApiError(404, 'Doctor profile not found.'));
    }

    if (profile.status === DOCTOR_STATUS.PENDING) {
      return next(
        new ApiError(
          403,
          'Your doctor profile is pending admin approval. You cannot access this feature until approved.'
        )
      );
    }

    if (profile.status === DOCTOR_STATUS.REJECTED) {
      return next(
        new ApiError(
          403,
          `Your doctor registration was rejected: ${profile.rejection_reason || 'Please contact administration.'}`
        )
      );
    }

    if (profile.status === DOCTOR_STATUS.SUSPENDED) {
      return next(
        new ApiError(
          403,
          'Your doctor account has been suspended by an administrator. Please contact administration.'
        )
      );
    }

    if (profile.status !== DOCTOR_STATUS.APPROVED) {
      return next(new ApiError(403, 'Doctor account is not in an active approved state.'));
    }

    // Attach fresh profile to request for subsequent handlers
    req.doctorProfile = profile;
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = { requireApprovedDoctor };
