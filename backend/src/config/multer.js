const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { FILE_UPLOAD } = require('./constants');
const ApiError = require('../utils/ApiError');

// Storage for certificates
const certificateStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'uploads', 'certificates'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = `${uuidv4()}${ext}`;
    cb(null, filename);
  },
});

// Storage for logos
const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'uploads', 'logos'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = `logo-${Date.now()}${ext}`;
    cb(null, filename);
  },
});

// File filter for certificates
const certificateFilter = (req, file, cb) => {
  if (FILE_UPLOAD.ALLOWED_CERT_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new ApiError(400, `Invalid file type. Allowed: ${FILE_UPLOAD.ALLOWED_CERT_TYPES.join(', ')}`), false);
  }
};

// File filter for logos
const logoFilter = (req, file, cb) => {
  if (FILE_UPLOAD.ALLOWED_LOGO_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new ApiError(400, `Invalid file type. Allowed: ${FILE_UPLOAD.ALLOWED_LOGO_TYPES.join(', ')}`), false);
  }
};

const uploadCertificate = multer({
  storage: certificateStorage,
  fileFilter: certificateFilter,
  limits: { fileSize: FILE_UPLOAD.CERTIFICATE_MAX_SIZE },
});

const uploadLogo = multer({
  storage: logoStorage,
  fileFilter: logoFilter,
  limits: { fileSize: FILE_UPLOAD.LOGO_MAX_SIZE },
});

module.exports = { uploadCertificate, uploadLogo };
