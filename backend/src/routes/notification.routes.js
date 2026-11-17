const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const { authenticate } = require('../middleware/auth.middleware');
const {
  notificationQueryRules,
  notificationParamRules,
} = require('../validators/notification.validator');
const { validate } = require('../middleware/validate.middleware');

// All notification routes require authentication (Patient, Doctor, Admin)
router.use(authenticate);

// Get authenticated user's notifications
router.get('/', notificationQueryRules, validate, notificationController.getMyNotifications);

// Get unread notification count
router.get('/unread-count', notificationController.getUnreadCount);

// Mark all notifications as read
router.patch('/read-all', notificationController.markAllAsRead);

// Mark single notification as read
router.patch('/:id/read', notificationParamRules, validate, notificationController.markAsRead);

module.exports = router;
