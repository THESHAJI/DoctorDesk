const { body, param, query } = require('express-validator');

const createPrescriptionRules = [
  body('appointmentId')
    .notEmpty()
    .withMessage('Appointment ID is required')
    .isInt({ min: 1 })
    .withMessage('Appointment ID must be a positive integer'),

  body('diagnosis')
    .optional({ nullable: true })
    .isString()
    .withMessage('Diagnosis must be a string')
    .trim(),

  body('notes')
    .optional({ nullable: true })
    .isString()
    .withMessage('Notes must be a string')
    .trim(),

  body('items')
    .isArray({ min: 1 })
    .withMessage('Prescription must contain at least one item'),

  body('items.*.medicine_name')
    .notEmpty()
    .withMessage('Medicine name is required')
    .isString()
    .withMessage('Medicine name must be a string')
    .trim()
    .isLength({ max: 255 })
    .withMessage('Medicine name cannot exceed 255 characters'),

  body('items.*.dosage')
    .notEmpty()
    .withMessage('Dosage is required (e.g. 500mg)')
    .isString()
    .withMessage('Dosage must be a string')
    .trim()
    .isLength({ max: 100 })
    .withMessage('Dosage cannot exceed 100 characters'),

  body('items.*.frequency')
    .notEmpty()
    .withMessage('Frequency is required (e.g. 1-0-1)')
    .isString()
    .withMessage('Frequency must be a string')
    .trim()
    .isLength({ max: 100 })
    .withMessage('Frequency cannot exceed 100 characters'),

  body('items.*.duration')
    .notEmpty()
    .withMessage('Duration is required (e.g. 5 days)')
    .isString()
    .withMessage('Duration must be a string')
    .trim()
    .isLength({ max: 100 })
    .withMessage('Duration cannot exceed 100 characters'),

  body('items.*.instructions')
    .optional({ nullable: true })
    .isString()
    .withMessage('Instructions must be a string')
    .trim(),
];

const prescriptionParamRules = [
  param('id')
    .notEmpty()
    .withMessage('Prescription ID is required')
    .isInt({ min: 1 })
    .withMessage('Prescription ID must be a positive integer'),
];

const prescriptionQueryRules = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
];

module.exports = {
  createPrescriptionRules,
  prescriptionParamRules,
  prescriptionQueryRules,
};
