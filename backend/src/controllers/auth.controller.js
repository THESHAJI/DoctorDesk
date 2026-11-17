const AuthService = require('../services/auth.service');
const ApiResponse = require('../utils/ApiResponse');
const catchAsync = require('../utils/catchAsync');
const { getAuthCookieOptions, getClearCookieOptions } = require('../utils/cookieHelper');

/**
 * Controller: Register Patient
 */
const registerPatient = catchAsync(async (req, res) => {
  const result = await AuthService.registerPatient(req.body);

  // Set secure HTTP-only cookie
  res.cookie('token', result.token, getAuthCookieOptions());

  return ApiResponse.created(res, 'Patient registered successfully', {
    user: result.user,
  });
});

/**
 * Controller: Register Doctor
 */
const registerDoctor = catchAsync(async (req, res) => {
  const result = await AuthService.registerDoctor(req.body);

  // Set secure HTTP-only cookie
  res.cookie('token', result.token, getAuthCookieOptions());

  return ApiResponse.created(
    res,
    'Doctor registered successfully. Profile is pending admin approval.',
    {
      user: result.user,
    }
  );
});

/**
 * Controller: Login (Patient, Doctor, Admin)
 */
const login = catchAsync(async (req, res) => {
  const { email, password } = req.body;
  const result = await AuthService.login(email, password);

  // Set secure HTTP-only cookie
  res.cookie('token', result.token, getAuthCookieOptions());

  return ApiResponse.success(res, 200, 'Login successful', {
    user: result.user,
  });
});

/**
 * Controller: Logout
 * Clears the authentication cookie using matching security options
 */
const logout = catchAsync(async (req, res) => {
  res.clearCookie('token', getClearCookieOptions());
  return ApiResponse.success(res, 200, 'Logged out successfully');
});

/**
 * Controller: Get Current User Profile (Me)
 */
const getMe = catchAsync(async (req, res) => {
  const user = await AuthService.getMe(req.user.id);
  return ApiResponse.success(res, 200, 'User profile retrieved successfully', {
    user,
  });
});

module.exports = {
  registerPatient,
  registerDoctor,
  login,
  logout,
  getMe,
};
