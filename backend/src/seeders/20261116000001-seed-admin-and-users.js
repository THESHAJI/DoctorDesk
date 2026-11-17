'use strict';

const bcrypt = require('bcryptjs');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const hashSeedPassword = async (name) => {
      const password = process.env[name];
      if (!password || password.length < 12) {
        throw new Error(`${name} must be set to a unique password of at least 12 characters before seeding.`);
      }

      return bcrypt.hash(password, await bcrypt.genSalt(10));
    };

    const [adminPassword, doctorPassword, patientPassword] = await Promise.all([
      hashSeedPassword('SEED_ADMIN_PASSWORD'),
      hashSeedPassword('SEED_DOCTOR_PASSWORD'),
      hashSeedPassword('SEED_PATIENT_PASSWORD'),
    ]);

    const now = new Date();

    // 1. Seed Users
    const users = await queryInterface.bulkInsert(
      'users',
      [
        {
          name: 'Super Admin',
          email: 'admin@doctordesk.com',
          phone: '+91 9876543210',
          password_hash: adminPassword,
          role: 'admin',
          is_active: true,
          created_at: now,
          updated_at: now,
        },
        {
          name: 'Dr. Rajesh Kumar',
          email: 'doctor@doctordesk.com',
          phone: '+91 9876543211',
          password_hash: doctorPassword,
          role: 'doctor',
          is_active: true,
          created_at: now,
          updated_at: now,
        },
        {
          name: 'Dr. Priya Sharma',
          email: 'dr.sharma@doctordesk.com',
          phone: '+91 9876543212',
          password_hash: doctorPassword,
          role: 'doctor',
          is_active: true,
          created_at: now,
          updated_at: now,
        },
        {
          name: 'John Doe',
          email: 'patient@doctordesk.com',
          phone: '+91 9876543213',
          password_hash: patientPassword,
          role: 'patient',
          is_active: true,
          created_at: now,
          updated_at: now,
        },
      ],
      { returning: ['id', 'email'] }
    );

    // Fetch user IDs
    const [userRows] = await queryInterface.sequelize.query(
      `SELECT id, email, role FROM users WHERE email IN ('admin@doctordesk.com', 'doctor@doctordesk.com', 'dr.sharma@doctordesk.com', 'patient@doctordesk.com');`
    );

    const admin = userRows.find((u) => u.email === 'admin@doctordesk.com');
    const doctor1 = userRows.find((u) => u.email === 'doctor@doctordesk.com');
    const doctor2 = userRows.find((u) => u.email === 'dr.sharma@doctordesk.com');

    // 2. Seed Doctor Profiles
    if (doctor1 && doctor2) {
      await queryInterface.bulkInsert('doctor_profiles', [
        {
          user_id: doctor1.id,
          specialization: 'Cardiologist',
          qualification: 'MBBS, MD (Cardiology), FACC',
          consultation_fee: 600.0,
          bio: 'Senior Interventional Cardiologist with over 15 years of experience in cardiovascular care, hypertension management, and preventive heart health.',
          status: 'approved',
          approved_by: admin ? admin.id : null,
          approved_at: now,
          rejection_reason: null,
          created_at: now,
          updated_at: now,
        },
        {
          user_id: doctor2.id,
          specialization: 'Dermatologist',
          qualification: 'MBBS, DVD, MD (Dermatology)',
          consultation_fee: 450.0,
          bio: 'Specialist in clinical and aesthetic dermatology with 8 years of practice focusing on skin, hair, and pediatric dermatology.',
          status: 'pending',
          approved_by: null,
          approved_at: null,
          rejection_reason: null,
          created_at: now,
          updated_at: now,
        },
      ]);
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('users', {
      email: [
        'admin@doctordesk.com',
        'doctor@doctordesk.com',
        'dr.sharma@doctordesk.com',
        'patient@doctordesk.com',
      ],
    });
  },
};
