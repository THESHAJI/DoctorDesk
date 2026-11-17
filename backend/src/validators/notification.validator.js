const { query, param } = require('express-validator');

const notificationQueryRules = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),

  query('unreadOnly')
    .optional()
    .isBoolean()
    .withMessage('unreadOnly must be a boolean (true or false)'),
];

const notificationParamRules = [
  param('id')
    .notEmpty()
    .withMessage('Notification ID is required')
    .isInt({ min: 1 })
    .withMessage('Notification ID must be a positive integer'),
];

module.exports = {
  notificationQueryRules,
  notificationParamRules,
};
