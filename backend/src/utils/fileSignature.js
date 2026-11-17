const fs = require('fs');

/**
 * Validates the file signature (magic bytes) of an uploaded file on disk.
 * Opens a read-only file handle, reads the first 8 bytes, and determines
 * the true file type regardless of client-supplied extensions or headers.
 *
 * Supported Signatures:
 * - PDF:  %PDF (0x25 0x50 0x44 0x46)
 * - JPEG: \xFF\xD8\xFF (0xFF 0xD8 0xFF)
 * - PNG:  \x89PNG (0x89 0x50 0x4E 0x47)
 *
 * @param {string} filePath - Absolute path to the file on disk
 * @returns {Promise<string|null>} Detected MIME type, or null if unrecognized
 */
const detectMimeTypeFromMagicBytes = async (filePath) => {
  let fileHandle = null;
  try {
    fileHandle = await fs.promises.open(filePath, 'r');
    const buffer = Buffer.alloc(8);
    const { bytesRead } = await fileHandle.read(buffer, 0, 8, 0);

    if (bytesRead < 4) {
      return null;
    }

    // PDF check: starts with '%PDF' (0x25 0x50 0x44 0x46)
    if (
      buffer[0] === 0x25 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x44 &&
      buffer[3] === 0x46
    ) {
      return 'application/pdf';
    }

    // JPEG check: starts with 0xFF 0xD8 0xFF
    if (
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    ) {
      return 'image/jpeg';
    }

    // PNG check: starts with 0x89 'PNG' (0x89 0x50 0x4E 0x47)
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      return 'image/png';
    }

    return null;
  } catch (error) {
    return null;
  } finally {
    if (fileHandle) {
      try {
        await fileHandle.close();
      } catch (closeErr) {
        // Ignore close error
      }
    }
  }
};

const parsePngDimensions = (buffer) => {
  if (buffer.length < 24) {
    throw new Error('PNG header is incomplete');
  }
  if (
    buffer[12] !== 0x49 ||
    buffer[13] !== 0x48 ||
    buffer[14] !== 0x44 ||
    buffer[15] !== 0x52
  ) {
    throw new Error('Invalid PNG: IHDR chunk missing');
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
};

const parseJpegDimensions = (buffer) => {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error('Invalid JPEG signature');
  }

  let offset = 2;
  while (offset < buffer.length - 1) {
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }

    while (offset < buffer.length - 1 && buffer[offset + 1] === 0xff) {
      offset++;
    }

    if (offset >= buffer.length - 1) break;
    const marker = buffer[offset + 1];
    offset += 2;

    if (marker === 0xd8 || marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);

    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isSof) {
      if (offset + 7 > buffer.length) {
        throw new Error('Corrupt JPEG SOF segment');
      }
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      return { width, height };
    }

    offset += length;
  }

  throw new Error('Could not locate JPEG SOF marker');
};

const DIMENSION_LIMITS = {
  MIN_WIDTH: 16,
  MIN_HEIGHT: 16,
  MAX_WIDTH: 2048,
  MAX_HEIGHT: 2048,
  MAX_PIXELS: 2048 * 2048, // 4,194,304 (4MP)
};

/**
 * Validates dimensions of an uploaded PNG or JPEG image without external libraries.
 * Enforces min 16x16, max 2048x2048, and max 4,194,304 pixels.
 *
 * @param {string} filePath - Path to file on disk
 * @param {string} mimeType - 'image/png' or 'image/jpeg'
 * @returns {Promise<{ width: number, height: number }>}
 */
const validateImageDimensions = async (filePath, mimeType) => {
  let fileHandle = null;
  try {
    fileHandle = await fs.promises.open(filePath, 'r');
    const buffer = Buffer.alloc(65536);
    const { bytesRead } = await fileHandle.read(buffer, 0, 65536, 0);
    const slice = buffer.subarray(0, bytesRead);

    let dims = null;
    if (mimeType === 'image/png') {
      dims = parsePngDimensions(slice);
    } else if (mimeType === 'image/jpeg') {
      dims = parseJpegDimensions(slice);
    } else {
      throw new Error(`Unsupported image type '${mimeType}' for dimension inspection`);
    }

    const { width, height } = dims;

    if (width < DIMENSION_LIMITS.MIN_WIDTH || height < DIMENSION_LIMITS.MIN_HEIGHT) {
      throw new Error(
        `Image dimensions ${width}x${height} are too small. Minimum size is ${DIMENSION_LIMITS.MIN_WIDTH}x${DIMENSION_LIMITS.MIN_HEIGHT} pixels.`
      );
    }

    if (width > DIMENSION_LIMITS.MAX_WIDTH || height > DIMENSION_LIMITS.MAX_HEIGHT) {
      throw new Error(
        `Image dimensions ${width}x${height} exceed maximum allowed ${DIMENSION_LIMITS.MAX_WIDTH}x${DIMENSION_LIMITS.MAX_HEIGHT} pixels.`
      );
    }

    if (width * height > DIMENSION_LIMITS.MAX_PIXELS) {
      throw new Error(
        `Total image pixels (${width * height}) exceed the maximum allowed limit of ${DIMENSION_LIMITS.MAX_PIXELS} pixels.`
      );
    }

    return dims;
  } finally {
    if (fileHandle) {
      try {
        await fileHandle.close();
      } catch (_) {}
    }
  }
};

module.exports = {
  detectMimeTypeFromMagicBytes,
  validateImageDimensions,
  DIMENSION_LIMITS,
};
