const { body } = require('express-validator');
const { ROLES } = require('../config/constants');

const registerPatientRules = [
  body('name')
    .trim()
    .notEmpty().withMessage('Name is required')
    .isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),

  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email')
    .normalizeEmail(),

  body('phone')
    .optional()
    .trim()
    .matches(/^[+]?[\d\s-]{7,20}$/).withMessage('Please provide a valid phone number'),

  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
    .matches(/[0-9]/).withMessage('Password must contain at least one number'),

  body('confirmPassword')
    .notEmpty().withMessage('Please confirm your password')
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('Passwords do not match');
      }
      return true;
    }),
];

const registerDoctorRules = [
  ...registerPatientRules,

  body('specialization')
    .trim()
    .notEmpty().withMessage('Specialization is required')
    .isLength({ max: 100 }).withMessage('Specialization must be under 100 characters'),

  body('qualification')
    .trim()
    .notEmpty().withMessage('Qualification is required')
    .isLength({ max: 255 }).withMessage('Qualification must be under 255 characters'),

  body('consultationFee')
    .notEmpty().withMessage('Consultation fee is required')
    .isFloat({ min: 0 }).withMessage('Consultation fee must be a positive number'),

  body('bio')
    .optional()
    .trim()
    .isLength({ max: 2000 }).withMessage('Bio must be under 2000 characters'),
];

const loginRules = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email')
    .normalizeEmail(),

  body('password')
    .notEmpty().withMessage('Password is required'),
];

module.exports = {
  registerPatientRules,
  registerDoctorRules,
  loginRules,
};
