const express = require('express');
const router = express.Router();
const prescriptionController = require('../controllers/prescription.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');
const {
  createPrescriptionRules,
  prescriptionParamRules,
  prescriptionQueryRules,
} = require('../validators/prescription.validator');
const { validate } = require('../middleware/validate.middleware');
const { ROLES } = require('../config/constants');

// All prescription routes require authentication
router.use(authenticate);

// Doctor: Create prescription for an appointment
router.post(
  '/',
  authorize(ROLES.DOCTOR),
  createPrescriptionRules,
  validate,
  prescriptionController.createPrescription
);

// Patient: List own prescriptions
router.get(
  '/my',
  authorize(ROLES.PATIENT),
  prescriptionQueryRules,
  validate,
  prescriptionController.getMyPatientPrescriptions
);

// Doctor: List prescriptions written by doctor
router.get(
  '/doctor',
  authorize(ROLES.DOCTOR),
  prescriptionQueryRules,
  validate,
  prescriptionController.getMyDoctorPrescriptions
);

// Patient / Doctor: Get single prescription by ID
router.get(
  '/:id',
  authorize(ROLES.PATIENT, ROLES.DOCTOR, ROLES.ADMIN),
  prescriptionParamRules,
  validate,
  prescriptionController.getPrescriptionById
);

module.exports = router;
