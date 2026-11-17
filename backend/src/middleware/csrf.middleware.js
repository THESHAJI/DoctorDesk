/**
 * CSRF Defense-in-Depth Middleware
 *
 * WHY this exists:
 * SameSite=Lax cookies block cross-origin POST/PUT/DELETE/PATCH requests
 * in modern browsers. However, a simple HTML <form> POST can still send
 * Content-Type 'application/x-www-form-urlencoded' or 'text/plain' to our
 * API, and the browser attaches cookies for same-site requests. If Express
 * parses that body (via express.urlencoded()), the mutation could execute.
 *
 * DEFENSE:
 * This middleware ensures that all state-changing requests (POST, PUT,
 * DELETE, PATCH) carry a Content-Type containing 'application/json'.
 * HTML forms CANNOT set 'application/json' as Content-Type, so this
 * blocks form-based CSRF attempts even from the same origin.
 *
 * Combined with:
 *   - SameSite=Lax cookies (blocks cross-site cookie sending for POST)
 *   - CORS with explicit origin (blocks cross-origin XHR/fetch)
 * This provides layered CSRF protection without requiring CSRF tokens.
 *
 * EXEMPTIONS:
 * - GET and HEAD requests (safe, read-only by convention)
 * - File upload routes (multipart/form-data) — exempted by path
 */

const ApiError = require('../utils/ApiError');

// Exact routes that allow multipart/form-data upload, subject to explicit Origin validation
const isMultipartUploadRoute = (req) => {
  if (req.method === 'POST' && req.originalUrl.startsWith('/api/doctors/certificates')) {
    return true;
  }
  if (req.method === 'PUT' && req.originalUrl.startsWith('/api/admin/settings/branding')) {
    return true;
  }
  return false;
};

const requireJsonContentType = (req, res, next) => {
  // Only enforce on state-changing HTTP methods
  const mutationMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
  if (!mutationMethods.includes(req.method)) {
    return next();
  }

  // Check if current request is an upload route
  if (isMultipartUploadRoute(req)) {
    const contentType = req.headers['content-type'] || '';

    // If branding update is sent as pure JSON (e.g. updating appName only), allow JSON
    if (
      req.originalUrl.startsWith('/api/admin/settings/branding') &&
      contentType.includes('application/json')
    ) {
      return next();
    }

    // Explicit Origin Verification: Validate Origin / Referer header against trusted frontend
    const trustedOrigin =
      process.env.NODE_ENV === 'production'
        ? process.env.FRONTEND_URL
        : 'http://localhost:5173';

    const origin = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : null);

    // If Origin is missing or untrusted, reject immediately (CSRF defense)
    if (!origin || origin !== trustedOrigin) {
      return next(
        new ApiError(403, 'Forbidden. Invalid or missing request Origin for file upload.')
      );
    }

    // Require multipart/form-data for the upload route
    if (!contentType.includes('multipart/form-data')) {
      return next(
        new ApiError(
          415,
          'Unsupported Media Type. Upload requires multipart/form-data.'
        )
      );
    }

    return next();
  }

  // For all standard mutations, strictly enforce application/json
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/json')) {
    return next(
      new ApiError(
        415,
        'Unsupported Media Type. This API only accepts application/json for state-changing requests.'
      )
    );
  }

  next();
};

module.exports = { requireJsonContentType };
