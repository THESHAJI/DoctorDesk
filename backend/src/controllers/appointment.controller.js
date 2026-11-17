const AppointmentService = require('../services/appointment.service');
const ApiResponse = require('../utils/ApiResponse');
const catchAsync = require('../utils/catchAsync');

/**
 * Patient: Book an appointment for an available slot
 */
const bookAppointment = catchAsync(async (req, res) => {
  const result = await AppointmentService.bookAppointment(req.user.id, req.body);
  return ApiResponse.created(res, 'Appointment booked successfully', result);
});

/**
 * Patient / Doctor: Cancel a booked appointment
 */
const cancelAppointment = catchAsync(async (req, res) => {
  const result = await AppointmentService.cancelAppointment(
    req.user.id,
    req.user.role,
    req.params.id,
    req.body.reason
  );
  return ApiResponse.success(res, 200, 'Appointment cancelled successfully', result);
});

const getMyAppointments = catchAsync(async (req, res) => {
  const result = await AppointmentService.getPatientAppointments(req.user.id, req.query);
  return ApiResponse.success(res, 200, 'Appointments retrieved successfully', result);
});

const getDoctorAppointments = catchAsync(async (req, res) => {
  const result = await AppointmentService.getDoctorAppointments(req.user.id, req.query);
  return ApiResponse.success(res, 200, 'Appointments retrieved successfully', result);
});

const completeAppointment = catchAsync(async (req, res) => {
  const result = await AppointmentService.completeAppointment(req.user.id, req.params.id);
  return ApiResponse.success(res, 200, 'Appointment completed successfully', result);
});

module.exports = {
  bookAppointment,
  cancelAppointment,
  getMyAppointments,
  getDoctorAppointments,
  completeAppointment,
};
