'use strict';

/**
 * Milestone 9: Admin Portal Backend APIs Test Suite
 * Tests covering:
 * - Admin authorization protection (401, 403)
 * - Dashboard statistics & revenue aggregation
 * - User listing & active status updates (with self & last-admin deactivation guards)
 * - Global appointment monitoring & strict date filter validation
 * - Commission settings GET/PUT & fee snapshot preservation
 * - Branding settings GET/PUT & secure logo upload lifecycle
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const app = require('../src/app');
const {
  User,
  DoctorProfile,
  Appointment,
  AvailabilitySlot,
  AppSetting,
  sequelize,
} = require('../src/models');
const {
  ROLES,
  DOCTOR_STATUS,
  APPOINTMENT_STATUS,
  COMMISSION_TYPE,
} = require('../src/config/constants');
const { LOGO_UPLOAD_DIR } = require('../src/config/upload.config');

// Mock Sequelize models for Unit/API testing
jest.mock('../src/models', () => {
  const actualModels = jest.requireActual('../src/models');
  return {
    ...actualModels,
    User: {
      ...actualModels.User,
      findByPk: jest.fn(),
      findOne: jest.fn(),
      findAll: jest.fn(),
      findAndCountAll: jest.fn(),
      count: jest.fn(),
    },
    DoctorProfile: {
      ...actualModels.DoctorProfile,
      findByPk: jest.fn(),
      findOne: jest.fn(),
      findAll: jest.fn(),
      findAndCountAll: jest.fn(),
      count: jest.fn(),
    },
    Appointment: {
      ...actualModels.Appointment,
      findByPk: jest.fn(),
      findOne: jest.fn(),
      findAll: jest.fn(),
      findAndCountAll: jest.fn(),
      count: jest.fn(),
    },
    AvailabilitySlot: {
      ...actualModels.AvailabilitySlot,
      findByPk: jest.fn(),
      findOne: jest.fn(),
      findAll: jest.fn(),
    },
    AppSetting: {
      ...actualModels.AppSetting,
      findOne: jest.fn(),
      findAll: jest.fn(),
      upsert: jest.fn(),
    },
    sequelize: {
      ...actualModels.sequelize,
      transaction: jest.fn(),
    },
  };
});

describe('Milestone 9: Admin Portal Backend APIs', () => {
  const testJwtSecret = 'milestone_9_test_secret_key_12345';
  let adminToken;
  let admin2Token;
  let doctorToken;
  let patientToken;

  const createdTestFiles = [];
  const createDummyFile = (filename, bufferContent) => {
    const filePath = path.join(__dirname, filename);
    fs.writeFileSync(filePath, bufferContent);
    createdTestFiles.push(filePath);
    return filePath;
  };

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = testJwtSecret;
    process.env.JWT_EXPIRES_IN = '1h';

    adminToken = jwt.sign(
      { id: 1, email: 'admin@doctordesk.com', role: ROLES.ADMIN },
      testJwtSecret
    );
    admin2Token = jwt.sign(
      { id: 99, email: 'admin2@doctordesk.com', role: ROLES.ADMIN },
      testJwtSecret
    );
    doctorToken = jwt.sign(
      { id: 2, email: 'doctor@doctordesk.com', role: ROLES.DOCTOR },
      testJwtSecret
    );
    patientToken = jwt.sign(
      { id: 3, email: 'patient@doctordesk.com', role: ROLES.PATIENT },
      testJwtSecret
    );
  });

  afterAll(() => {
    for (const f of createdTestFiles) {
      if (fs.existsSync(f)) {
        try {
          fs.unlinkSync(f);
        } catch (_) {}
      }
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();

    sequelize.transaction.mockImplementation(async (callback) => {
      const mockTx = {
        LOCK: { UPDATE: 'UPDATE' },
        commit: jest.fn(),
        rollback: jest.fn(),
      };
      return await callback(mockTx);
    });
  });

  // ==========================================
  // 1. AUTHORIZATION CONTROLS
  // ==========================================
  describe('Authorization Checks', () => {
    it('should reject unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/admin/dashboard/stats');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject patient role with 403', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard/stats')
        .set('Authorization', `Bearer ${patientToken}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should reject doctor role with 403', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard/stats')
        .set('Authorization', `Bearer ${doctorToken}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  // ==========================================
  // 2. DASHBOARD STATISTICS
  // ==========================================
  describe('GET /api/admin/dashboard/stats', () => {
    it('should return aggregated counts and platform revenue metrics', async () => {
      User.count
        .mockResolvedValueOnce(50)  // total
        .mockResolvedValueOnce(35)  // patient
        .mockResolvedValueOnce(12)  // doctor
        .mockResolvedValueOnce(3)   // admin
        .mockResolvedValueOnce(48)  // active
        .mockResolvedValueOnce(2);  // inactive

      DoctorProfile.count
        .mockResolvedValueOnce(12)  // total
        .mockResolvedValueOnce(2)   // pending
        .mockResolvedValueOnce(8)   // approved
        .mockResolvedValueOnce(1)   // rejected
        .mockResolvedValueOnce(1);  // suspended

      Appointment.count
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(40)  // booked
        .mockResolvedValueOnce(50)  // completed
        .mockResolvedValueOnce(8)   // cancelled
        .mockResolvedValueOnce(2)   // rescheduled
        .mockResolvedValueOnce(0);  // no_show

      Appointment.findAll.mockResolvedValueOnce([
        {
          total_consultation_volume: '25000.00',
          total_commission_earned: '2500.00',
          total_doctor_payout: '22500.00',
        },
      ]);

      const res = await request(app)
        .get('/api/admin/dashboard/stats')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.users).toEqual({
        total: 50,
        patients: 35,
        doctors: 12,
        admins: 3,
        active: 48,
        inactive: 2,
      });
      expect(res.body.data.doctors).toEqual({
        total: 12,
        pending: 2,
        approved: 8,
        rejected: 1,
        suspended: 1,
      });
      expect(res.body.data.appointments).toEqual({
        total: 100,
        booked: 40,
        completed: 50,
        cancelled: 8,
        rescheduled: 2,
        no_show: 0,
      });
      expect(res.body.data.revenue).toEqual({
        total_consultation_volume: 25000,
        total_commission_earned: 2500,
        total_doctor_payout: 22500,
      });
    });
  });

  // ==========================================
  // 3. USER MANAGEMENT & LAST-ADMIN PROTECTION
  // ==========================================
  describe('User Management APIs', () => {
    describe('GET /api/admin/users', () => {
      it('should return paginated users and honor filters', async () => {
        User.findAndCountAll.mockResolvedValueOnce({
          count: 1,
          rows: [
            {
              id: 10,
              name: 'John Doe',
              email: 'john@example.com',
              phone: '+91 9876543210',
              role: ROLES.PATIENT,
              is_active: true,
              toJSON: () => ({
                id: 10,
                name: 'John Doe',
                email: 'john@example.com',
                phone: '+91 9876543210',
                role: ROLES.PATIENT,
                is_active: true,
              }),
            },
          ],
        });

        const res = await request(app)
          .get('/api/admin/users?role=patient&is_active=true&search=john')
          .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.users.length).toBe(1);
        expect(res.body.data.pagination).toEqual({
          totalItems: 1,
          totalPages: 1,
          currentPage: 1,
          limit: 10,
        });
      });

      it('should search users by phone number safely without leaking sensitive fields', async () => {
        User.findAndCountAll.mockResolvedValueOnce({
          count: 1,
          rows: [
            {
              id: 11,
              name: 'Jane Smith',
              email: 'jane@example.com',
              phone: '+91 9876543211',
              role: ROLES.DOCTOR,
              is_active: true,
              toJSON: () => ({
                id: 11,
                name: 'Jane Smith',
                email: 'jane@example.com',
                phone: '+91 9876543211',
                role: ROLES.DOCTOR,
                is_active: true,
              }),
            },
          ],
        });

        const res = await request(app)
          .get('/api/admin/users?search=9876543211')
          .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data.users.length).toBe(1);
        expect(res.body.data.users[0].phone).toBe('+91 9876543211');
        expect(res.body.data.users[0]).not.toHaveProperty('password_hash');
      });

      it('should validate query parameters and reject invalid values', async () => {
        const res = await request(app)
          .get('/api/admin/users?role=invalid_role')
          .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(422);
        expect(res.body.success).toBe(false);
      });
    });

    describe('PATCH /api/admin/users/:id/status', () => {
      it('should prevent an admin from deactivating their own account (HTTP 400)', async () => {
        const res = await request(app)
          .patch('/api/admin/users/1/status')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ is_active: false });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/cannot deactivate their own account/i);
      });

      it('should successfully activate or deactivate a regular user', async () => {
        const mockTargetUser = {
          id: 5,
          role: ROLES.PATIENT,
          is_active: true,
          update: jest.fn().mockResolvedValue(true),
          toJSON: () => ({ id: 5, role: ROLES.PATIENT, is_active: false }),
        };
        User.findByPk
          .mockResolvedValueOnce(mockTargetUser)  // Initial read without lock
          .mockResolvedValueOnce(mockTargetUser); // Lock target user

        const res = await request(app)
          .patch('/api/admin/users/5/status')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ is_active: false });

        expect(res.status).toBe(200);
        expect(mockTargetUser.update).toHaveBeenCalledWith(
          { is_active: false },
          expect.any(Object)
        );
      });

      it('should prevent deactivating the last active administrator with row locking (HTTP 400)', async () => {
        const mockAdminUser = {
          id: 99,
          role: ROLES.ADMIN,
          is_active: true,
          update: jest.fn(),
          toJSON: () => ({ id: 99, role: ROLES.ADMIN, is_active: true }),
        };
        User.findByPk.mockResolvedValueOnce(mockAdminUser); // Initial read without lock

        // Active admin check returns only 1 active admin
        User.findAll.mockResolvedValueOnce([mockAdminUser]);

        const res = await request(app)
          .patch('/api/admin/users/99/status')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ is_active: false });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/last active administrator/i);
        expect(User.findAll).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { role: ROLES.ADMIN, is_active: true },
            order: [['id', 'ASC']],
            lock: 'UPDATE',
          })
        );
      });

      it('should allow deactivating an admin if at least one other active admin remains', async () => {
        const mockAdminUser = {
          id: 99,
          role: ROLES.ADMIN,
          is_active: true,
          update: jest.fn().mockResolvedValue(true),
          toJSON: () => ({ id: 99, role: ROLES.ADMIN, is_active: false }),
        };
        User.findByPk.mockResolvedValueOnce(mockAdminUser); // Initial read without lock

        // Two active admins exist
        User.findAll.mockResolvedValueOnce([
          { id: 1, role: ROLES.ADMIN, is_active: true },
          mockAdminUser,
        ]);

        const res = await request(app)
          .patch('/api/admin/users/99/status')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ is_active: false });

        expect(res.status).toBe(200);
        expect(mockAdminUser.update).toHaveBeenCalledWith(
          { is_active: false },
          expect.any(Object)
        );
      });

      it('should return 404 when target user is missing', async () => {
        User.findByPk.mockResolvedValueOnce(null);

        const res = await request(app)
          .patch('/api/admin/users/999/status')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ is_active: false });

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
      });

      it('should handle concurrent deactivation between initial read and lock acquisition', async () => {
        const initialAdmin = {
          id: 99,
          role: ROLES.ADMIN,
          is_active: true,
        };
        const alreadyDeactivatedAdmin = {
          id: 99,
          role: ROLES.ADMIN,
          is_active: false,
          toJSON: () => ({ id: 99, is_active: false }),
        };

        User.findByPk
          .mockResolvedValueOnce(initialAdmin)            // 1. Initial read
          .mockResolvedValueOnce(alreadyDeactivatedAdmin); // 2. Refreshed target when not in activeAdmins

        // activeAdmins does not contain 99 (already deactivated concurrently)
        User.findAll.mockResolvedValueOnce([
          { id: 1, role: ROLES.ADMIN, is_active: true },
        ]);

        const res = await request(app)
          .patch('/api/admin/users/99/status')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ is_active: false });

        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/already deactivated/i);
      });

      it('should return 409 if target role changed concurrently to admin during deactivation', async () => {
        const initialPatient = {
          id: 5,
          role: ROLES.PATIENT,
          is_active: true,
        };
        const concurrentlyPromotedAdmin = {
          id: 5,
          role: ROLES.ADMIN,
          is_active: true,
        };

        User.findByPk
          .mockResolvedValueOnce(initialPatient)             // Initial read: patient
          .mockResolvedValueOnce(concurrentlyPromotedAdmin);  // Lock target: changed to admin

        const res = await request(app)
          .patch('/api/admin/users/5/status')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ is_active: false });

        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/role changed concurrently/i);
      });

      it('should return 409 and not update status if target admin was concurrently demoted to patient', async () => {
        const initialAdmin = {
          id: 99,
          role: ROLES.ADMIN,
          is_active: true,
        };
        const concurrentlyDemotedPatient = {
          id: 99,
          role: ROLES.PATIENT,
          is_active: true,
          update: jest.fn(),
        };

        User.findByPk
          .mockResolvedValueOnce(initialAdmin)                // 1. Initial unlocked read: active ADMIN
          .mockResolvedValueOnce(concurrentlyDemotedPatient); // 2. Refreshed locked target: demoted to PATIENT

        // Active-admin query does not return 99 because its role in DB was demoted
        User.findAll.mockResolvedValueOnce([
          { id: 1, role: ROLES.ADMIN, is_active: true },
        ]);

        const res = await request(app)
          .patch('/api/admin/users/99/status')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ is_active: false });

        expect(res.status).toBe(409);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toMatch(/role changed concurrently/i);
        expect(concurrentlyDemotedPatient.update).not.toHaveBeenCalled();
      });
    });
  });

  // ==========================================
  // 4. GLOBAL APPOINTMENT MONITORING
  // ==========================================
  describe('GET /api/admin/appointments', () => {
    it('should return paginated appointments', async () => {
      Appointment.findAndCountAll.mockResolvedValueOnce({
        count: 1,
        rows: [
          {
            id: 101,
            patient_id: 3,
            doctor_profile_id: 1,
            status: APPOINTMENT_STATUS.BOOKED,
            toJSON: () => ({
              id: 101,
              status: APPOINTMENT_STATUS.BOOKED,
            }),
          },
        ],
      });

      const res = await request(app)
        .get('/api/admin/appointments?status=booked')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.appointments.length).toBe(1);
    });

    it('uses the slot_date database column and derives payout from stored fee snapshots', async () => {
      Appointment.findAndCountAll.mockResolvedValueOnce({
        count: 1,
        rows: [{
          toJSON: () => ({
            id: 102,
            consultation_fee: '120.00',
            commission_amount: '12.00',
            slot: { id: 9, slot_date: '2026-12-01', start_time: '10:00:00' },
          }),
        }],
      });

      const res = await request(app)
        .get('/api/admin/appointments?startDate=2026-12-01&endDate=2026-12-05')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.appointments[0].slot.slot_date).toBe('2026-12-01');
      expect(res.body.data.appointments[0].doctor_payout_amount).toBe(108);

      const query = Appointment.findAndCountAll.mock.calls[0][0];
      const slotInclude = query.include.find((include) => include.as === 'slot');
      expect(slotInclude.attributes).toContain('slot_date');
      expect(slotInclude.attributes).not.toContain('date');
      expect(slotInclude.where.slot_date).toEqual(expect.objectContaining({
        [require('sequelize').Op.gte]: '2026-12-01',
        [require('sequelize').Op.lte]: '2026-12-05',
      }));
    });

    it('should reject inverted slot date range (endDate < startDate) with 422', async () => {
      const res = await request(app)
        .get('/api/admin/appointments?startDate=2026-11-20&endDate=2026-11-10')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });

    it('should reject invalid date format with 422', async () => {
      const res = await request(app)
        .get('/api/admin/appointments?startDate=20-11-2026')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });

    it('should reject inverted created date range (createdTo < createdFrom) with 422', async () => {
      const res = await request(app)
        .get('/api/admin/appointments?createdFrom=2026-11-20&createdTo=2026-11-10')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });
  });

  // ==========================================
  // 5. COMMISSION SETTINGS
  // ==========================================
  describe('Commission Settings APIs', () => {
    it('GET /api/admin/settings/commission should return current configuration', async () => {
      AppSetting.findOne
        .mockResolvedValueOnce({ value: COMMISSION_TYPE.PERCENTAGE })
        .mockResolvedValueOnce({ value: '15' });

      const res = await request(app)
        .get('/api/admin/settings/commission')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        commissionType: COMMISSION_TYPE.PERCENTAGE,
        commissionValue: 15,
      });
    });

    it('PUT /api/admin/settings/commission should validate percentage ceiling (<= 100)', async () => {
      const res = await request(app)
        .put('/api/admin/settings/commission')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          commissionType: COMMISSION_TYPE.PERCENTAGE,
          commissionValue: 150,
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });

    it('PUT /api/admin/settings/commission should update configuration successfully', async () => {
      AppSetting.upsert.mockResolvedValue(true);

      const res = await request(app)
        .put('/api/admin/settings/commission')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          commissionType: COMMISSION_TYPE.FIXED,
          commissionValue: 200,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.commissionType).toBe(COMMISSION_TYPE.FIXED);
      expect(res.body.data.commissionValue).toBe(200);
    });
  });

  // ==========================================
  // 6. BRANDING SETTINGS & LOGO LIFECYCLE
  // ==========================================
  describe('Branding Settings APIs', () => {
    it('GET /api/admin/settings/branding should return appName and appLogo', async () => {
      AppSetting.findOne
        .mockResolvedValueOnce({ value: 'HealthDesk' })
        .mockResolvedValueOnce({ value: 'logo-abc.png' });

      const res = await request(app)
        .get('/api/admin/settings/branding')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        appName: 'HealthDesk',
        appLogo: 'logo-abc.png',
      });
    });

    it('PUT /api/admin/settings/branding should reject arbitrary client appLogo paths with 422', async () => {
      const res = await request(app)
        .put('/api/admin/settings/branding')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          appName: 'New Brand',
          appLogo: '/etc/passwd',
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });

    it('PUT /api/admin/settings/branding should successfully update appName', async () => {
      AppSetting.findOne
        .mockResolvedValueOnce(null) // current logo
        .mockResolvedValueOnce({ value: 'Updated HealthDesk' })
        .mockResolvedValueOnce({ value: '' });

      const res = await request(app)
        .put('/api/admin/settings/branding')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ appName: 'Updated HealthDesk' });

      expect(res.status).toBe(200);
      expect(res.body.data.appName).toBe('Updated HealthDesk');
    });

    it('PUT /api/admin/settings/branding should upload valid logo and inspect magic bytes & dimensions', async () => {
      // Valid PNG header (33 bytes) with width 200 (0x000000C8) and height 100 (0x00000064):
      const pngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // Signature (8 bytes)
        0x00, 0x00, 0x00, 0x0d,                         // IHDR chunk length (13)
        0x49, 0x48, 0x44, 0x52,                         // 'IHDR' (4 bytes)
        0x00, 0x00, 0x00, 0xc8,                         // Width: 200px (4 bytes)
        0x00, 0x00, 0x00, 0x64,                         // Height: 100px (4 bytes)
        0x08, 0x02, 0x00, 0x00, 0x00,                   // Bit depth 8, truecolor, comp 0, filter 0, interlace 0 (5 bytes)
        0x00, 0x00, 0x00, 0x00,                         // CRC (4 bytes)
      ]);
      const validPngPath = createDummyFile('test-logo.png', pngBuffer);

      AppSetting.findOne
        .mockResolvedValueOnce({ value: 'old-logo.png' }) // current logo to be replaced
        .mockResolvedValueOnce({ value: 'My Health App' })
        .mockResolvedValueOnce({ value: 'logo-new.png' });

      const res = await request(app)
        .put('/api/admin/settings/branding')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Origin', 'http://localhost:5173')
        .field('appName', 'My Health App')
        .attach('logo', validPngPath);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('PUT /api/admin/settings/branding should reject oversized image dimensions (>2048px) with 422', async () => {
      // PNG with Width 3000 (0x00000BB8) and Height 3000 (0x00000BB8)
      const oversizedPngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x0b, 0xb8,                         // Width: 3000px
        0x00, 0x00, 0x0b, 0xb8,                         // Height: 3000px
        0x08, 0x02, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
      ]);
      const oversizedPath = createDummyFile('oversized.png', oversizedPngBuffer);

      const res = await request(app)
        .put('/api/admin/settings/branding')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Origin', 'http://localhost:5173')
        .attach('logo', oversizedPath);

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/exceed maximum allowed 2048x2048/i);
    });

    it('PUT /api/admin/settings/branding should reject undersized image dimensions (<16px) with 422', async () => {
      // PNG with Width 8 (0x00000008) and Height 8 (0x00000008)
      const tinyPngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x08,                         // Width: 8px
        0x00, 0x00, 0x00, 0x08,                         // Height: 8px
        0x08, 0x02, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
      ]);
      const tinyPath = createDummyFile('tiny.png', tinyPngBuffer);

      const res = await request(app)
        .put('/api/admin/settings/branding')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Origin', 'http://localhost:5173')
        .attach('logo', tinyPath);

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/too small. Minimum size is 16x16/i);
    });

    it('PUT /api/admin/settings/branding should reject spoofed file extensions with 422', async () => {
      // Create a text file disguised as PNG
      const fakePngBuffer = Buffer.from('NOT A REAL PNG FILE');
      const spoofedPath = createDummyFile('spoofed.png', fakePngBuffer);

      const res = await request(app)
        .put('/api/admin/settings/branding')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Origin', 'http://localhost:5173')
        .attach('logo', spoofedPath);

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/corrupt or has a spoofed extension/i);
    });

    it('GET /api/admin/settings/branding/logo should return 404 when no logo is set', async () => {
      AppSetting.findOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/admin/settings/branding/logo')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });
});
