const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');
const { rejectDoctorRules, suspendDoctorRules } = require('../validators/doctor.validator');
const {
  getUsersRules,
  updateUserStatusRules,
  getAppointmentsRules,
  updateCommissionRules,
  updateBrandingRules,
} = require('../validators/admin.validator');
const { uploadLogoMiddleware } = require('../middleware/upload.middleware');
const { validate } = require('../middleware/validate.middleware');
const { ROLES } = require('../config/constants');

// All admin routes require authentication and ADMIN role
router.use(authenticate, authorize(ROLES.ADMIN));

// Dashboard Statistics
router.get('/dashboard/stats', adminController.getDashboardStats);

// User Management
router.get('/users', getUsersRules, validate, adminController.getUsers);
router.patch('/users/:id/status', updateUserStatusRules, validate, adminController.updateUserStatus);

// Global Appointment Monitoring
router.get('/appointments', getAppointmentsRules, validate, adminController.getAppointments);

// Platform Commission Settings
router.get('/settings/commission', adminController.getCommissionSettings);
router.put('/settings/commission', updateCommissionRules, validate, adminController.updateCommissionSettings);

// Branding Settings & Secure Logo Upload/Retrieval
router.get('/settings/branding', adminController.getBrandingSettings);
router.get('/settings/branding/logo', adminController.getBrandingLogo);
router.put(
  '/settings/branding',
  uploadLogoMiddleware,
  updateBrandingRules,
  validate,
  adminController.updateBrandingSettings
);

// List and inspect doctor applications
router.get('/doctors', adminController.getDoctorApplications);
router.get('/doctors/:id', adminController.getDoctorApplicationById);

// Status transition actions
router.patch('/doctors/:id/approve', adminController.approveDoctor);
router.patch('/doctors/:id/reject', rejectDoctorRules, validate, adminController.rejectDoctor);
router.patch('/doctors/:id/suspend', suspendDoctorRules, validate, adminController.suspendDoctor);

module.exports = router;
