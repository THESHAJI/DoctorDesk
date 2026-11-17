const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const {
  registerPatientRules,
  registerDoctorRules,
  loginRules,
} = require('../validators/auth.validator');
const { validate } = require('../middleware/validate.middleware');
const { authenticate } = require('../middleware/auth.middleware');

// Public authentication routes
router.post('/register', registerPatientRules, validate, authController.registerPatient);
router.post('/register/doctor', registerDoctorRules, validate, authController.registerDoctor);
router.post('/login', loginRules, validate, authController.login);

// Protected routes (requires valid JWT in cookie or Authorization header)
router.post('/logout', authenticate, authController.logout);
router.get('/me', authenticate, authController.getMe);

module.exports = router;
