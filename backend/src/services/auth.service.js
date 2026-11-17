const jwt = require('jsonwebtoken');
const { User, DoctorProfile, sequelize } = require('../models');
const { ROLES, DOCTOR_STATUS } = require('../config/constants');
const ApiError = require('../utils/ApiError');

class AuthService {
  /**
   * Helper to generate a signed JWT
   * Payload contains only safe identity claims (id, email, role).
   * Expiration is read from environment variable JWT_EXPIRES_IN (default: 7d).
   */
  static generateToken(user) {
    const jwtSecret = process.env.JWT_SECRET;
    const jwtExpiresIn = process.env.JWT_EXPIRES_IN || '7d';

    if (!jwtSecret) {
      throw new ApiError(500, 'Server configuration error: JWT_SECRET is not configured.');
    }

    return jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      jwtSecret,
      { expiresIn: jwtExpiresIn }
    );
  }

  /**
   * Register a new patient
   * Security: The role is strictly hardcoded to 'patient'. Any role provided by the client is discarded.
   */
  static async registerPatient(data) {
    const normalizedEmail = data.email.toLowerCase().trim();

    // Check if email is already taken
    const existingUser = await User.findOne({ where: { email: normalizedEmail } });
    if (existingUser) {
      throw new ApiError(409, 'Email is already registered. Please log in.');
    }

    // Create patient user (role is forced to PATIENT)
    const user = await User.create({
      name: data.name.trim(),
      email: normalizedEmail,
      phone: data.phone ? data.phone.trim() : null,
      password_hash: data.password, // Hook in User.js will hash via bcrypt
      role: ROLES.PATIENT,
      is_active: true,
    });

    const token = AuthService.generateToken(user);

    return {
      user: user.toJSON(),
      token,
    };
  }

  /**
   * Register a new doctor
   * Security: The role is strictly hardcoded to 'doctor'. Initial status is strictly 'pending'.
   * Uses a database transaction so User and DoctorProfile are created atomically.
   */
  static async registerDoctor(data) {
    const normalizedEmail = data.email.toLowerCase().trim();

    // Check if email is already taken
    const existingUser = await User.findOne({ where: { email: normalizedEmail } });
    if (existingUser) {
      throw new ApiError(409, 'Email is already registered. Please log in.');
    }

    return await sequelize.transaction(async (t) => {
      // 1. Create user with role DOCTOR
      const user = await User.create(
        {
          name: data.name.trim(),
          email: normalizedEmail,
          phone: data.phone ? data.phone.trim() : null,
          password_hash: data.password,
          role: ROLES.DOCTOR,
          is_active: true,
        },
        { transaction: t }
      );

      // 2. Create initial pending doctor profile
      const doctorProfile = await DoctorProfile.create(
        {
          user_id: user.id,
          specialization: data.specialization.trim(),
          qualification: data.qualification.trim(),
          consultation_fee: parseFloat(data.consultationFee),
          bio: data.bio ? data.bio.trim() : null,
          status: DOCTOR_STATUS.PENDING, // Strictly pending until admin approval
        },
        { transaction: t }
      );

      const token = AuthService.generateToken(user);

      const userData = user.toJSON();
      userData.doctorProfile = doctorProfile.toJSON();

      return {
        user: userData,
        token,
      };
    });
  }

  /**
   * User login (Patient, Doctor, Admin)
   * Generic error message prevents email enumeration attacks.
   */
  static async login(email, password) {
    const normalizedEmail = email.toLowerCase().trim();

    const user = await User.findOne({ where: { email: normalizedEmail } });
    if (!user || !user.is_active) {
      throw new ApiError(401, 'Invalid email or password');
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      throw new ApiError(401, 'Invalid email or password');
    }

    let doctorProfile = null;
    if (user.role === ROLES.DOCTOR) {
      doctorProfile = await DoctorProfile.findOne({ where: { user_id: user.id } });
    }

    const token = AuthService.generateToken(user);

    const userData = user.toJSON();
    if (doctorProfile) {
      userData.doctorProfile = doctorProfile.toJSON();
    }

    return {
      user: userData,
      token,
    };
  }

  /**
   * Retrieve current authenticated user profile
   */
  static async getMe(userId) {
    const user = await User.findByPk(userId, {
      include: [
        {
          model: DoctorProfile,
          as: 'doctorProfile',
        },
      ],
    });

    if (!user || !user.is_active) {
      throw new ApiError(404, 'User not found or inactive');
    }

    return user.toJSON();
  }
}

module.exports = AuthService;
