/**
 * Wraps an async route handler to catch errors and pass to next().
 * Without this, every controller would need try-catch blocks.
 * 
 * Usage: router.get('/users', catchAsync(async (req, res) => { ... }));
 */
const catchAsync = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

module.exports = catchAsync;
