const ApiError = require('../utils/ApiError');

/**
 * Check if authenticated user has one of the allowed roles.
 * Must be used AFTER authenticate middleware.
 * 
 * Usage: router.get('/admin/dashboard', authenticate, authorize('admin'), controller)
 */
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new ApiError(401, 'Authentication required'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new ApiError(403, `Access denied. Required role: ${allowedRoles.join(' or ')}`)
      );
    }

    next();
  };
};

module.exports = { authorize };
