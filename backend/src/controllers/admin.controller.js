const AdminService = require('../services/admin.service');
const ApiResponse = require('../utils/ApiResponse');
const catchAsync = require('../utils/catchAsync');

/**
 * Admin: List All Doctor Applications
 */
const getDoctorApplications = catchAsync(async (req, res) => {
  const result = await AdminService.getDoctorApplications(req.query);
  return ApiResponse.success(res, 200, 'Doctor applications retrieved successfully', result);
});

/**
 * Admin: Get Single Doctor Application Detail
 */
const getDoctorApplicationById = catchAsync(async (req, res) => {
  const application = await AdminService.getDoctorApplicationById(req.params.id);
  return ApiResponse.success(res, 200, 'Doctor application details retrieved successfully', {
    application,
  });
});

/**
 * Admin: Approve Doctor
 */
const approveDoctor = catchAsync(async (req, res) => {
  const result = await AdminService.approveDoctor(req.user.id, req.params.id);
  return ApiResponse.success(res, 200, result.message, { doctor: result.doctor });
});

/**
 * Admin: Reject Doctor
 */
const rejectDoctor = catchAsync(async (req, res) => {
  const { reason } = req.body;
  const result = await AdminService.rejectDoctor(req.user.id, req.params.id, reason);
  return ApiResponse.success(res, 200, result.message, { doctor: result.doctor });
});

/**
 * Admin: Suspend Doctor
 */
const suspendDoctor = catchAsync(async (req, res) => {
  const { reason } = req.body;
  const result = await AdminService.suspendDoctor(req.user.id, req.params.id, reason);
  return ApiResponse.success(res, 200, result.message, { doctor: result.doctor });
});

/**
 * Admin: Dashboard Statistics & Financial Aggregates
 */
const getDashboardStats = catchAsync(async (req, res) => {
  const stats = await AdminService.getDashboardStats();
  return ApiResponse.success(res, 200, 'Dashboard statistics retrieved successfully', stats);
});

/**
 * Admin: Paginated User Listing
 */
const getUsers = catchAsync(async (req, res) => {
  const result = await AdminService.getUsers(req.query);
  return ApiResponse.success(res, 200, 'Users retrieved successfully', result);
});

/**
 * Admin: Update User Status (Activation / Deactivation)
 */
const updateUserStatus = catchAsync(async (req, res) => {
  const { is_active } = req.body;
  const result = await AdminService.updateUserStatus(req.user.id, req.params.id, is_active);
  return ApiResponse.success(res, 200, result.message, { user: result.user });
});

/**
 * Admin: Global Appointment Monitoring
 */
const getAppointments = catchAsync(async (req, res) => {
  const result = await AdminService.getAppointments(req.query);
  return ApiResponse.success(res, 200, 'Appointments retrieved successfully', result);
});

/**
 * Admin: Retrieve Commission Settings
 */
const getCommissionSettings = catchAsync(async (req, res) => {
  const settings = await AdminService.getCommissionSettings();
  return ApiResponse.success(res, 200, 'Commission settings retrieved successfully', settings);
});

/**
 * Admin: Update Commission Settings
 */
const updateCommissionSettings = catchAsync(async (req, res) => {
  const { commissionType, commissionValue } = req.body;
  const result = await AdminService.updateCommissionSettings(req.user.id, {
    commissionType,
    commissionValue,
  });
  return ApiResponse.success(res, 200, result.message, result);
});

/**
 * Admin: Retrieve Branding Settings
 */
const getBrandingSettings = catchAsync(async (req, res) => {
  const settings = await AdminService.getBrandingSettings();
  return ApiResponse.success(res, 200, 'Branding settings retrieved successfully', settings);
});

/**
 * Admin: Update Branding Settings
 */
const updateBrandingSettings = catchAsync(async (req, res) => {
  const { appName, removeLogo } = req.body;
  const result = await AdminService.updateBrandingSettings(
    req.user.id,
    { appName, removeLogo },
    req.file
  );
  return ApiResponse.success(res, 200, result.message, result);
});

/**
 * Admin: Retrieve Branding Logo File Safely
 */
const getBrandingLogo = catchAsync(async (req, res) => {
  const logoPath = await AdminService.getBrandingLogoPath();
  if (!logoPath) {
    return res.status(404).json({ success: false, message: 'No custom logo configured' });
  }
  return res.sendFile(logoPath);
});

module.exports = {
  getDoctorApplications,
  getDoctorApplicationById,
  approveDoctor,
  rejectDoctor,
  suspendDoctor,
  getDashboardStats,
  getUsers,
  updateUserStatus,
  getAppointments,
  getCommissionSettings,
  updateCommissionSettings,
  getBrandingSettings,
  updateBrandingSettings,
  getBrandingLogo,
};
