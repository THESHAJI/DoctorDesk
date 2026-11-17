const path = require('path');
const fs = require('fs');

/**
 * Centralized File Upload Configuration
 * Defines storage paths, size limits, and allowed extensions.
 */

// Private storage directory (NEVER served via express.static)
const CERTIFICATE_UPLOAD_DIR = path.resolve('src', 'uploads', 'certificates');
const LOGO_UPLOAD_DIR = path.resolve('src', 'uploads', 'logos');

// Ensure upload directories exist synchronously on initialization
if (!fs.existsSync(CERTIFICATE_UPLOAD_DIR)) {
  fs.mkdirSync(CERTIFICATE_UPLOAD_DIR, { recursive: true });
}
if (!fs.existsSync(LOGO_UPLOAD_DIR)) {
  fs.mkdirSync(LOGO_UPLOAD_DIR, { recursive: true });
}

// 5MB maximum file size ceiling (5,242,880 bytes)
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE, 10) || 5 * 1024 * 1024;
// 2MB logo size ceiling
const MAX_LOGO_SIZE = 2 * 1024 * 1024;

// Allowed file extensions
const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png'];
const ALLOWED_LOGO_EXTENSIONS = ['.jpg', '.jpeg', '.png'];

// Allowed MIME types
const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const ALLOWED_LOGO_MIME_TYPES = ['image/jpeg', 'image/png'];

module.exports = {
  CERTIFICATE_UPLOAD_DIR,
  LOGO_UPLOAD_DIR,
  MAX_FILE_SIZE,
  MAX_LOGO_SIZE,
  ALLOWED_EXTENSIONS,
  ALLOWED_LOGO_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  ALLOWED_LOGO_MIME_TYPES,
};
