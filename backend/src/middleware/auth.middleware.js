const jwt = require('jsonwebtoken');
const ApiError = require('../utils/ApiError');

/**
 * Verify JWT token from HTTP-only cookie or Authorization header.
 * Attaches authenticated user payload to req.user.
 */
const authenticate = (req, res, next) => {
  try {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new ApiError(500, 'Server configuration error: JWT_SECRET is missing');
    }

    // Extract token from cookie (primary) or Authorization header (fallback for API testing)
    let token = req.cookies?.token;

    if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      throw new ApiError(401, 'Authentication required. Please log in.');
    }

    const decoded = jwt.verify(token, jwtSecret);

    // Attach user identity to request object
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
    };

    next();
  } catch (error) {
    if (error instanceof ApiError) {
      next(error);
    } else if (error.name === 'TokenExpiredError') {
      next(new ApiError(401, 'Authentication token has expired. Please log in again.'));
    } else if (error.name === 'JsonWebTokenError') {
      next(new ApiError(401, 'Invalid authentication token.'));
    } else {
      next(new ApiError(401, 'Authentication failed.'));
    }
  }
};

module.exports = { authenticate };
