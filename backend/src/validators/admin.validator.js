const { body, param, query } = require('express-validator');
const { COMMISSION_TYPE, APPOINTMENT_STATUS, ROLES } = require('../config/constants');

const approveRejectRules = [
  param('id')
    .isInt({ min: 1 }).withMessage('Invalid doctor profile ID'),

  body('reason')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Reason must be under 500 characters'),
];

const getUsersRules = [
  query('page')
    .optional()
    .isInt({ min: 1 }).withMessage('Page must be a positive integer'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),

  query('role')
    .optional()
    .isIn([ROLES.PATIENT, ROLES.DOCTOR, ROLES.ADMIN])
    .withMessage(`Role must be one of: ${ROLES.PATIENT}, ${ROLES.DOCTOR}, ${ROLES.ADMIN}`),

  query('is_active')
    .optional()
    .isIn(['true', 'false', true, false])
    .withMessage('is_active must be true or false'),

  query('search')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('Search query must be under 100 characters'),
];

const updateUserStatusRules = [
  param('id')
    .isInt({ min: 1 }).withMessage('Invalid user ID'),

  body('is_active')
    .notEmpty().withMessage('is_active is required')
    .isBoolean().withMessage('is_active must be a boolean')
    .toBoolean(),
];

const getAppointmentsRules = [
  query('page')
    .optional()
    .isInt({ min: 1 }).withMessage('Page must be a positive integer'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),

  query('status')
    .optional()
    .isIn(Object.values(APPOINTMENT_STATUS))
    .withMessage(`Status must be one of: ${Object.values(APPOINTMENT_STATUS).join(', ')}`),

  query('doctorId')
    .optional()
    .isInt({ min: 1 }).withMessage('Doctor ID must be a positive integer'),

  query('patientId')
    .optional()
    .isInt({ min: 1 }).withMessage('Patient ID must be a positive integer'),

  query('startDate')
    .optional()
    .matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('startDate must be in YYYY-MM-DD format')
    .isISO8601({ strict: true }).withMessage('startDate must be a valid calendar date'),

  query('endDate')
    .optional()
    .matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('endDate must be in YYYY-MM-DD format')
    .isISO8601({ strict: true }).withMessage('endDate must be a valid calendar date')
    .custom((value, { req }) => {
      if (req.query.startDate && value < req.query.startDate) {
        throw new Error('endDate cannot be earlier than startDate');
      }
      return true;
    }),

  query('createdFrom')
    .optional()
    .matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('createdFrom must be in YYYY-MM-DD format')
    .isISO8601({ strict: true }).withMessage('createdFrom must be a valid calendar date'),

  query('createdTo')
    .optional()
    .matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('createdTo must be in YYYY-MM-DD format')
    .isISO8601({ strict: true }).withMessage('createdTo must be a valid calendar date')
    .custom((value, { req }) => {
      if (req.query.createdFrom && value < req.query.createdFrom) {
        throw new Error('createdTo cannot be earlier than createdFrom');
      }
      return true;
    }),
];

const updateCommissionRules = [
  body('commissionType')
    .notEmpty().withMessage('Commission type is required')
    .isIn([COMMISSION_TYPE.PERCENTAGE, COMMISSION_TYPE.FIXED])
    .withMessage(`Commission type must be ${COMMISSION_TYPE.PERCENTAGE} or ${COMMISSION_TYPE.FIXED}`),

  body('commissionValue')
    .notEmpty().withMessage('Commission value is required')
    .isFloat({ min: 0 }).withMessage('Commission value must be a positive number')
    .custom((value, { req }) => {
      if (req.body.commissionType === COMMISSION_TYPE.PERCENTAGE && parseFloat(value) > 100) {
        throw new Error('Percentage commission cannot exceed 100');
      }
      return true;
    }),
];

const updateBrandingRules = [
  body('appName')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 }).withMessage('App name must be 1-100 characters'),

  body('removeLogo')
    .optional()
    .isIn(['true', 'false', true, false])
    .withMessage('removeLogo must be true or false'),

  body('appLogo')
    .custom((value) => {
      if (value !== undefined && value !== null && value !== '') {
        throw new Error('Direct appLogo file paths are forbidden. Please upload a logo file.');
      }
      return true;
    }),
];

module.exports = {
  approveRejectRules,
  getUsersRules,
  updateUserStatusRules,
  getAppointmentsRules,
  updateCommissionRules,
  updateBrandingRules,
};
