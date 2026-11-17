const express = require('express');
const router = express.Router();

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'DoctorDesk API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// Authentication routes
router.use('/auth', require('./auth.routes'));

// Doctor availability slots management (Doctor only)
router.use('/doctors/slots', require('./slot.routes'));

// Doctor self-service and public catalog routes
router.use('/doctors', require('./doctor.routes'));

// Patient appointment booking and management routes
router.use('/appointments', require('./appointment.routes'));

// Prescription management routes
router.use('/prescriptions', require('./prescription.routes'));

// Notification management routes
router.use('/notifications', require('./notification.routes'));

// Admin management routes
router.use('/admin', require('./admin.routes'));

// =========================================================================
// ISOLATED TEST ROUTES (Mounted ONLY during automated test runs)
// Never exposed in development or production environments
// =========================================================================
if (process.env.NODE_ENV === 'test') {
  const { authenticate } = require('../middleware/auth.middleware');
  const { authorize } = require('../middleware/role.middleware');
  const { requireApprovedDoctor } = require('../middleware/doctorStatus.middleware');
  const { ROLES } = require('../config/constants');

  // Test admin-only gate
  router.get('/test/admin-only', authenticate, authorize(ROLES.ADMIN), (req, res) => {
    res.json({ success: true, message: 'Admin access granted', user: req.user });
  });

  // Test patient-only gate
  router.get('/test/patient-only', authenticate, authorize(ROLES.PATIENT), (req, res) => {
    res.json({ success: true, message: 'Patient access granted', user: req.user });
  });

  // Test doctor-only gate
  router.get('/test/doctor-only', authenticate, authorize(ROLES.DOCTOR), (req, res) => {
    res.json({ success: true, message: 'Doctor access granted', user: req.user });
  });

  // Test approved-doctor gate (queries DB real-time to block pending/suspended/rejected)
  router.get('/test/approved-doctor-only', authenticate, requireApprovedDoctor, (req, res) => {
    res.json({
      success: true,
      message: 'Approved doctor access granted',
      doctorProfile: req.doctorProfile,
    });
  });
}

module.exports = router;
