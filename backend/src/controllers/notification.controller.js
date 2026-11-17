const NotificationService = require('../services/notification.service');
const ApiResponse = require('../utils/ApiResponse');
const catchAsync = require('../utils/catchAsync');

/**
 * List authenticated user's notifications (with pagination and optional unread filter)
 */
const getMyNotifications = catchAsync(async (req, res) => {
  const result = await NotificationService.getUserNotifications(req.user.id, req.query);
  return ApiResponse.success(res, 200, 'Notifications retrieved successfully', result);
});

/**
 * Get count of unread notifications for badge
 */
const getUnreadCount = catchAsync(async (req, res) => {
  const result = await NotificationService.getUnreadCount(req.user.id);
  return ApiResponse.success(res, 200, 'Unread count retrieved', result);
});

/**
 * Mark a single notification as read
 */
const markAsRead = catchAsync(async (req, res) => {
  const result = await NotificationService.markAsRead(
    req.user.id,
    parseInt(req.params.id, 10)
  );
  return ApiResponse.success(res, 200, 'Notification marked as read', result);
});

/**
 * Mark all unread notifications as read
 */
const markAllAsRead = catchAsync(async (req, res) => {
  const result = await NotificationService.markAllAsRead(req.user.id);
  return ApiResponse.success(res, 200, 'All notifications marked as read', result);
});

module.exports = {
  getMyNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
};
