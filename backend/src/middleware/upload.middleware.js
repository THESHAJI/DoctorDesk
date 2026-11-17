const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const ApiError = require('../utils/ApiError');
const {
  CERTIFICATE_UPLOAD_DIR,
  LOGO_UPLOAD_DIR,
  MAX_FILE_SIZE,
  MAX_LOGO_SIZE,
  ALLOWED_EXTENSIONS,
  ALLOWED_LOGO_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  ALLOWED_LOGO_MIME_TYPES,
} = require('../config/upload.config');
const {
  detectMimeTypeFromMagicBytes,
  validateImageDimensions,
} = require('../utils/fileSignature');

/**
 * Configure Multer diskStorage
 * Replaces client filename with a cryptographically random UUIDv4.
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, CERTIFICATE_UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${crypto.randomUUID()}${ext}`;
    cb(null, uniqueName);
  },
});

/**
 * Initial fileFilter for extension and declared MIME type
 */
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();

  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(
      new ApiError(
        422,
        `Invalid file extension '${ext}'. Allowed extensions are: ${ALLOWED_EXTENSIONS.join(', ')}`
      ),
      false
    );
  }

  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(
      new ApiError(
        422,
        `Invalid file MIME type '${file.mimetype}'. Allowed types: PDF, JPEG, PNG`
      ),
      false
    );
  }

  cb(null, true);
};

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
  fileFilter,
}).single('certificate');

/**
 * Upload Middleware with Multer error handling and 4-Layer Magic Byte validation
 */
const uploadCertificateMiddleware = (req, res, next) => {
  upload(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(
            new ApiError(
              413,
              `File exceeds the maximum allowed size of ${MAX_FILE_SIZE / (1024 * 1024)}MB`
            )
          );
        }
        return next(new ApiError(400, `Upload error: ${err.message}`));
      }
      return next(err);
    }

    // Ensure a file was actually provided
    if (!req.file) {
      return next(new ApiError(400, 'Please select a certificate file to upload'));
    }

    // Perform Layer 4: File Signature (Magic Bytes) inspection on the saved disk file
    try {
      const detectedMime = await detectMimeTypeFromMagicBytes(req.file.path);

      if (!detectedMime || !ALLOWED_MIME_TYPES.includes(detectedMime)) {
        // Validation failed: Immediately clean up the physical file from disk
        if (fs.existsSync(req.file.path)) {
          await fs.promises.unlink(req.file.path);
        }
        return next(
          new ApiError(
            422,
            'File content does not match allowed format. The file is corrupt or has a spoofed extension.'
          )
        );
      }

      // Attach detected verified MIME type to req.file
      req.file.verifiedMimeType = detectedMime;
      next();
    } catch (magicErr) {
      // Clean up file if validation throws
      if (fs.existsSync(req.file.path)) {
        await fs.promises.unlink(req.file.path).catch(() => {});
      }
      return next(magicErr);
    }
  });
};

/**
 * Configure Multer diskStorage for Branding Logos
 * Replaces client filename with a cryptographically random UUIDv4.
 */
const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, LOGO_UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `logo-${crypto.randomUUID()}${ext}`;
    cb(null, uniqueName);
  },
});

const logoFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();

  if (!ALLOWED_LOGO_EXTENSIONS.includes(ext)) {
    return cb(
      new ApiError(
        422,
        `Invalid file extension '${ext}'. Allowed extensions are: ${ALLOWED_LOGO_EXTENSIONS.join(', ')}`
      ),
      false
    );
  }

  if (!ALLOWED_LOGO_MIME_TYPES.includes(file.mimetype)) {
    return cb(
      new ApiError(
        422,
        `Invalid file MIME type '${file.mimetype}'. Allowed types: JPEG, PNG`
      ),
      false
    );
  }

  cb(null, true);
};

const logoUpload = multer({
  storage: logoStorage,
  limits: {
    fileSize: MAX_LOGO_SIZE,
  },
  fileFilter: logoFileFilter,
}).single('logo');

/**
 * Upload Middleware for Branding Logos with Multer error handling and Magic Byte validation
 * File upload is optional (if user is only updating appName).
 */
const uploadLogoMiddleware = (req, res, next) => {
  logoUpload(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(
            new ApiError(
              413,
              `File exceeds the maximum allowed size of ${MAX_LOGO_SIZE / (1024 * 1024)}MB`
            )
          );
        }
        return next(new ApiError(400, `Upload error: ${err.message}`));
      }
      return next(err);
    }

    // Logo is optional on branding update
    if (!req.file) {
      return next();
    }

    // Perform Magic Byte inspection on saved file
    try {
      const detectedMime = await detectMimeTypeFromMagicBytes(req.file.path);

      if (!detectedMime || !ALLOWED_LOGO_MIME_TYPES.includes(detectedMime)) {
        if (fs.existsSync(req.file.path)) {
          await fs.promises.unlink(req.file.path);
        }
        return next(
          new ApiError(
            422,
            'File content does not match allowed format. The image is corrupt or has a spoofed extension.'
          )
        );
      }

      // Perform Dimension and Header Integrity validation
      try {
        const dimensions = await validateImageDimensions(req.file.path, detectedMime);
        req.file.dimensions = dimensions;
      } catch (dimErr) {
        if (fs.existsSync(req.file.path)) {
          await fs.promises.unlink(req.file.path).catch(() => {});
        }
        return next(new ApiError(422, `Invalid image dimensions: ${dimErr.message}`));
      }

      req.file.verifiedMimeType = detectedMime;
      next();
    } catch (magicErr) {
      if (fs.existsSync(req.file.path)) {
        await fs.promises.unlink(req.file.path).catch(() => {});
      }
      return next(magicErr);
    }
  });
};

module.exports = {
  uploadCertificateMiddleware,
  uploadLogoMiddleware,
};
