const { body, param, query } = require('express-validator');
const { APPOINTMENT_STATUS } = require('../config/constants');

const bookAppointmentRules = [
  body('slotId')
    .notEmpty().withMessage('Slot ID is required')
    .isInt({ min: 1 }).withMessage('Invalid slot ID'),

  body('doctorProfileId')
    .optional()
    .isInt({ min: 1 }).withMessage('Invalid doctor profile ID'),
];

const cancelAppointmentRules = [
  param('id')
    .isInt({ min: 1 }).withMessage('Invalid appointment ID'),

  body('reason')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Reason must be under 500 characters'),
];

const rescheduleRequestRules = [
  param('id')
    .isInt({ min: 1 }).withMessage('Invalid appointment ID'),

  body('reason')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Reason must be under 500 characters'),
];

const appointmentListRules = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('status')
    .optional()
    .isIn(Object.values(APPOINTMENT_STATUS))
    .withMessage('Invalid appointment status'),
  query('startDate')
    .optional()
    .isDate({ format: 'YYYY-MM-DD', strictMode: true })
    .withMessage('Start date must use YYYY-MM-DD'),
  query('endDate')
    .optional()
    .isDate({ format: 'YYYY-MM-DD', strictMode: true })
    .withMessage('End date must use YYYY-MM-DD')
    .bail()
    .custom((endDate, { req }) => {
      if (req.query.startDate && endDate < req.query.startDate) {
        throw new Error('End date must be on or after start date');
      }
      return true;
    }),
];

const appointmentParamRules = [
  param('id').isInt({ min: 1 }).withMessage('Invalid appointment ID'),
];

const doctorRescheduleRules = [
  param('id').isInt({ min: 1 }).withMessage('Invalid appointment ID'),
  body('reason')
    .trim()
    .isLength({ min: 5, max: 500 })
    .withMessage('Reason must be between 5 and 500 characters'),
];

module.exports = {
  bookAppointmentRules,
  cancelAppointmentRules,
  rescheduleRequestRules,
  appointmentListRules,
  appointmentParamRules,
  doctorRescheduleRules,
};
