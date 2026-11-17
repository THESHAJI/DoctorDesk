const { validationResult } = require('express-validator');
const ApiError = require('../utils/ApiError');

/**
 * Run after express-validator checks.
 * If there are validation errors, throw ApiError with details.
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const extractedErrors = errors.array().map((err) => ({
      field: err.path,
      message: err.msg,
    }));

    throw new ApiError(422, 'Validation failed', extractedErrors);
  }

  next();
};

module.exports = { validate };
