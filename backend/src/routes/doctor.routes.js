const express = require('express');
const router = express.Router();
const doctorController = require('../controllers/doctor.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');
const { uploadCertificateMiddleware } = require('../middleware/upload.middleware');
const { updateProfileRules } = require('../validators/doctor.validator');
const { validate } = require('../middleware/validate.middleware');
const { ROLES } = require('../config/constants');

// =========================================================================
// 1. PUBLIC ENDPOINTS (Approved Doctors Catalog)
// =========================================================================
router.get('/', doctorController.getPublicDoctors);
router.get('/:id', doctorController.getPublicDoctorById);
router.get('/:id/slots', doctorController.getDoctorAvailableSlots);

// =========================================================================
// 2. DOCTOR SELF-SERVICE PROFILE ROUTES (Requires DOCTOR role)
// =========================================================================
router.get(
  '/profile/me',
  authenticate,
  authorize(ROLES.DOCTOR),
  doctorController.getMyProfile
);

router.put(
  '/profile/me',
  authenticate,
  authorize(ROLES.DOCTOR),
  updateProfileRules,
  validate,
  doctorController.updateMyProfile
);

// =========================================================================
// 3. DOCTOR CERTIFICATES ROUTES
// =========================================================================
// Upload certificate (Doctor only)
router.post(
  '/certificates',
  authenticate,
  authorize(ROLES.DOCTOR),
  uploadCertificateMiddleware,
  doctorController.uploadCertificate
);

// Download / stream certificate (Doctor owner or Admin)
router.get(
  '/certificates/:certificateId',
  authenticate,
  doctorController.downloadCertificate
);

// Delete certificate (Doctor owner only)
router.delete(
  '/certificates/:certificateId',
  authenticate,
  authorize(ROLES.DOCTOR),
  doctorController.deleteCertificate
);

module.exports = router;
