const PrescriptionService = require('../services/prescription.service');
const ApiResponse = require('../utils/ApiResponse');
const catchAsync = require('../utils/catchAsync');

/**
 * Doctor: Create prescription for a completed appointment
 */
const createPrescription = catchAsync(async (req, res) => {
  const result = await PrescriptionService.createPrescription(req.user.id, req.body);
  return ApiResponse.created(res, 'Prescription created successfully', result);
});

/**
 * Patient / Doctor: Get prescription details by ID
 */
const getPrescriptionById = catchAsync(async (req, res) => {
  const result = await PrescriptionService.getPrescriptionById(
    req.user.id,
    req.user.role,
    parseInt(req.params.id, 10)
  );
  return ApiResponse.success(res, 200, 'Prescription retrieved successfully', result);
});

/**
 * Patient: List own prescriptions
 */
const getMyPatientPrescriptions = catchAsync(async (req, res) => {
  const result = await PrescriptionService.getPatientPrescriptions(req.user.id, req.query);
  return ApiResponse.success(res, 200, 'Prescriptions retrieved successfully', result);
});

/**
 * Doctor: List prescriptions created by doctor
 */
const getMyDoctorPrescriptions = catchAsync(async (req, res) => {
  const result = await PrescriptionService.getDoctorPrescriptions(req.user.id, req.query);
  return ApiResponse.success(res, 200, 'Doctor prescriptions retrieved successfully', result);
});

module.exports = {
  createPrescription,
  getPrescriptionById,
  getMyPatientPrescriptions,
  getMyDoctorPrescriptions,
};
