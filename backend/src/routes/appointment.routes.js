const express = require('express');
const router = express.Router();
const appointmentController = require('../controllers/appointment.controller');
const rescheduleController = require('../controllers/reschedule.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');
const {
  bookAppointmentRules,
  cancelAppointmentRules,
  rescheduleRequestRules,
  appointmentListRules,
  appointmentParamRules,
  doctorRescheduleRules,
} = require('../validators/appointment.validator');
const { validate } = require('../middleware/validate.middleware');
const { ROLES } = require('../config/constants');

router.get(
  '/my',
  authenticate,
  authorize(ROLES.PATIENT),
  appointmentListRules,
  validate,
  appointmentController.getMyAppointments
);

router.get(
  '/doctor',
  authenticate,
  authorize(ROLES.DOCTOR),
  appointmentListRules,
  validate,
  appointmentController.getDoctorAppointments
);

// Patient: Book an appointment
router.post(
  '/',
  authenticate,
  authorize(ROLES.PATIENT),
  bookAppointmentRules,
  validate,
  appointmentController.bookAppointment
);

router.patch(
  '/:id/complete',
  authenticate,
  authorize(ROLES.DOCTOR),
  appointmentParamRules,
  validate,
  appointmentController.completeAppointment
);

// Patient / Doctor: Cancel a booked appointment
router.patch(
  '/:id/cancel',
  authenticate,
  authorize(ROLES.PATIENT, ROLES.DOCTOR),
  cancelAppointmentRules,
  validate,
  appointmentController.cancelAppointment
);

// =========================================================================
// RESCHEDULE ROUTES (Patient only)
// =========================================================================

// Patient: Request reschedule (creates pending request with suggested slot)
router.post(
  '/:id/reschedule',
  authenticate,
  authorize(ROLES.PATIENT),
  rescheduleRequestRules,
  validate,
  rescheduleController.requestReschedule
);

// Patient: View pending reschedule suggestion
router.get(
  '/:id/reschedule/suggestion',
  authenticate,
  authorize(ROLES.PATIENT),
  rescheduleController.getSuggestion
);

// Patient: Confirm reschedule suggestion
router.put(
  '/:id/reschedule/confirm',
  authenticate,
  authorize(ROLES.PATIENT),
  rescheduleController.confirmReschedule
);

// Patient: Reject reschedule suggestion
router.put(
  '/:id/reschedule/reject',
  authenticate,
  authorize(ROLES.PATIENT),
  rescheduleController.rejectReschedule
);

router.post(
  '/:id/doctor-reschedule',
  authenticate,
  authorize(ROLES.DOCTOR),
  doctorRescheduleRules,
  validate,
  rescheduleController.proposeDoctorReschedule
);

module.exports = router;
