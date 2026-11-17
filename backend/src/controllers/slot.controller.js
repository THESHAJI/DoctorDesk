const SlotService = require('../services/slot.service');
const ApiResponse = require('../utils/ApiResponse');
const catchAsync = require('../utils/catchAsync');

/**
 * Doctor: Create a single availability slot
 */
const createSlot = catchAsync(async (req, res) => {
  const slot = await SlotService.createSingleSlot(req.user.id, req.body);
  return ApiResponse.created(res, 'Availability slot created successfully', { slot });
});

/**
 * Doctor: Bulk generate availability slots
 */
const createBulkSlots = catchAsync(async (req, res) => {
  const result = await SlotService.createBulkSlots(req.user.id, req.body);
  return ApiResponse.created(res, 'Availability slots generated successfully', result);
});

/**
 * Doctor: Get own availability slots
 */
const getMySlots = catchAsync(async (req, res) => {
  const slots = await SlotService.getDoctorSlots(req.user.id, req.query);
  return ApiResponse.success(res, 200, 'Doctor slots retrieved successfully', { slots });
});

/**
 * Doctor: Block an available slot
 */
const blockSlot = catchAsync(async (req, res) => {
  const result = await SlotService.blockSlot(req.user.id, parseInt(req.params.id, 10));
  return ApiResponse.success(res, 200, 'Slot blocked successfully', result);
});

/**
 * Doctor: Unblock a blocked slot
 */
const unblockSlot = catchAsync(async (req, res) => {
  const result = await SlotService.unblockSlot(req.user.id, parseInt(req.params.id, 10));
  return ApiResponse.success(res, 200, 'Slot unblocked successfully', result);
});

/**
 * Doctor: Safe-delete an availability slot
 */
const deleteSlot = catchAsync(async (req, res) => {
  const result = await SlotService.deleteSlot(req.user.id, parseInt(req.params.id, 10));
  return ApiResponse.success(res, 200, 'Availability slot deleted successfully', result);
});

module.exports = {
  createSlot,
  createBulkSlots,
  getMySlots,
  blockSlot,
  unblockSlot,
  deleteSlot,
};
