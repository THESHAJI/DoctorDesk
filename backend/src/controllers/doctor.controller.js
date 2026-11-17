const DoctorService = require('../services/doctor.service');
const SlotService = require('../services/slot.service');
const ApiResponse = require('../utils/ApiResponse');
const catchAsync = require('../utils/catchAsync');

/**
 * Doctor: Get Current User's Doctor Profile
 */
const getMyProfile = catchAsync(async (req, res) => {
  const profile = await DoctorService.getMyProfile(req.user.id);
  return ApiResponse.success(res, 200, 'Doctor profile retrieved successfully', { profile });
});

/**
 * Doctor: Update Current User's Doctor Profile
 */
const updateMyProfile = catchAsync(async (req, res) => {
  const updated = await DoctorService.updateMyProfile(req.user.id, req.body);
  return ApiResponse.success(res, 200, 'Doctor profile updated successfully', { profile: updated });
});

/**
 * Doctor: Upload Medical License / Certificate
 */
const uploadCertificate = catchAsync(async (req, res) => {
  const certificate = await DoctorService.uploadCertificate(req.user.id, req.file);
  return ApiResponse.created(res, 'Certificate uploaded successfully', { certificate });
});

/**
 * Doctor / Admin: Download Certificate
 * Enforces X-Content-Type-Options: nosniff and Content-Disposition: attachment
 */
const downloadCertificate = catchAsync(async (req, res) => {
  const { certificateId } = req.params;
  const certData = await DoctorService.getCertificateForDownload(
    req.user.id,
    req.user.role,
    certificateId
  );

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${encodeURIComponent(certData.originalName)}"`
  );
  res.setHeader('Content-Type', certData.mimeType);

  return res.sendFile(certData.filePath);
});

/**
 * Doctor: Delete Certificate
 */
const deleteCertificate = catchAsync(async (req, res) => {
  const { certificateId } = req.params;
  const result = await DoctorService.deleteCertificate(req.user.id, certificateId);
  return ApiResponse.success(res, 200, result.message, { id: result.id });
});

/**
 * Public: List Approved Doctors
 */
const getPublicDoctors = catchAsync(async (req, res) => {
  const result = await DoctorService.getPublicDoctors(req.query);
  return ApiResponse.success(res, 200, 'Approved doctors retrieved successfully', result);
});

/**
 * Public: Get Approved Doctor Profile by ID
 */
const getPublicDoctorById = catchAsync(async (req, res) => {
  const doctor = await DoctorService.getPublicDoctorById(req.params.id);
  return ApiResponse.success(res, 200, 'Doctor details retrieved successfully', { doctor });
});

/**
 * Public / Patient: Get Available Slots of an Approved Doctor
 */
const getDoctorAvailableSlots = catchAsync(async (req, res) => {
  const slots = await SlotService.getDoctorAvailableSlots(req.params.id, req.query);
  return ApiResponse.success(res, 200, 'Available slots retrieved successfully', { slots });
});

module.exports = {
  getMyProfile,
  updateMyProfile,
  uploadCertificate,
  downloadCertificate,
  deleteCertificate,
  getPublicDoctors,
  getPublicDoctorById,
  getDoctorAvailableSlots,
};
