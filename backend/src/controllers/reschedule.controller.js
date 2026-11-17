const RescheduleService = require('../services/reschedule.service');
const ApiResponse = require('../utils/ApiResponse');
const catchAsync = require('../utils/catchAsync');

/**
 * Patient: Request appointment reschedule
 */
const requestReschedule = catchAsync(async (req, res) => {
  const result = await RescheduleService.requestReschedule(
    req.user.id,
    parseInt(req.params.id, 10),
    req.body.reason
  );
  return ApiResponse.created(res, 'Reschedule request created with suggested slot', result);
});

/**
 * Patient: View pending reschedule suggestion
 */
const getSuggestion = catchAsync(async (req, res) => {
  const result = await RescheduleService.getSuggestion(
    req.user.id,
    parseInt(req.params.id, 10)
  );
  return ApiResponse.success(res, 200, 'Reschedule suggestion retrieved', result);
});

/**
 * Patient: Confirm reschedule suggestion
 */
const confirmReschedule = catchAsync(async (req, res) => {
  const result = await RescheduleService.confirmReschedule(
    req.user.id,
    parseInt(req.params.id, 10)
  );
  return ApiResponse.success(res, 200, 'Appointment rescheduled successfully', result);
});

/**
 * Patient: Reject reschedule suggestion
 */
const rejectReschedule = catchAsync(async (req, res) => {
  const result = await RescheduleService.rejectReschedule(
    req.user.id,
    parseInt(req.params.id, 10)
  );
  return ApiResponse.success(res, 200, 'Reschedule suggestion rejected', result);
});

const proposeDoctorReschedule = catchAsync(async (req, res) => {
  const result = await RescheduleService.proposeDoctorReschedule(
    req.user.id,
    parseInt(req.params.id, 10),
    req.body.reason
  );
  return ApiResponse.created(res, 'Reschedule suggestion sent for patient confirmation', result);
});

module.exports = {
  requestReschedule,
  getSuggestion,
  confirmReschedule,
  rejectReschedule,
  proposeDoctorReschedule,
};
