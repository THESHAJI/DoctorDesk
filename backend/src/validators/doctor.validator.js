const { body, param, query } = require('express-validator');

const updateProfileRules = [
  body('specialization')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 }).withMessage('Specialization must be 2-100 characters'),

  body('qualification')
    .optional()
    .trim()
    .isLength({ max: 255 }).withMessage('Qualification must be under 255 characters'),

  body('consultationFee')
    .optional()
    .isFloat({ min: 0 }).withMessage('Consultation fee must be a positive number'),

  body('bio')
    .optional()
    .trim()
    .isLength({ max: 2000 }).withMessage('Bio must be under 2000 characters'),
];

const rejectDoctorRules = [
  param('id')
    .isInt({ min: 1 }).withMessage('Doctor ID must be a positive integer'),

  body('reason')
    .trim()
    .notEmpty().withMessage('Rejection reason is required')
    .isLength({ min: 5, max: 1000 }).withMessage('Rejection reason must be between 5 and 1000 characters'),
];

const suspendDoctorRules = [
  param('id')
    .isInt({ min: 1 }).withMessage('Doctor ID must be a positive integer'),

  body('reason')
    .trim()
    .notEmpty().withMessage('Suspension reason is required')
    .isLength({ min: 5, max: 1000 }).withMessage('Suspension reason must be between 5 and 1000 characters'),
];

const createSlotRules = [
  body('slotDate')
    .notEmpty().withMessage('Slot date is required')
    .isDate({ format: 'YYYY-MM-DD', strictMode: true }).withMessage('Invalid date format (YYYY-MM-DD)'),

  body('startTime')
    .notEmpty().withMessage('Start time is required')
    .matches(/^([01]\d|2[0-3]):([0-5]\d)$/).withMessage('Invalid start time format (HH:MM, 24-hour)'),

  body('endTime')
    .notEmpty().withMessage('End time is required')
    .matches(/^([01]\d|2[0-3]):([0-5]\d)$/).withMessage('Invalid end time format (HH:MM, 24-hour)'),
];

const createBulkSlotRules = [
  body('slotDate')
    .notEmpty().withMessage('Slot date is required')
    .isDate({ format: 'YYYY-MM-DD', strictMode: true }).withMessage('Invalid date format (YYYY-MM-DD)'),

  body('startTime')
    .notEmpty().withMessage('Start time is required')
    .matches(/^([01]\d|2[0-3]):([0-5]\d)$/).withMessage('Invalid start time format (HH:MM, 24-hour)'),

  body('endTime')
    .notEmpty().withMessage('End time is required')
    .matches(/^([01]\d|2[0-3]):([0-5]\d)$/).withMessage('Invalid end time format (HH:MM, 24-hour)'),

  body('duration')
    .notEmpty().withMessage('Slot duration is required')
    .isInt().withMessage('Duration must be an integer')
    .toInt()
    .isIn([15, 20, 30, 45, 60]).withMessage('Duration must be 15, 20, 30, 45, or 60 minutes'),
];

const slotParamRules = [
  param('id')
    .isInt({ min: 1 }).withMessage('Slot ID must be a positive integer'),
];

module.exports = {
  updateProfileRules,
  rejectDoctorRules,
  suspendDoctorRules,
  createSlotRules,
  createBulkSlotRules,
  slotParamRules,
};
