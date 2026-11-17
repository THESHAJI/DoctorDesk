const db = require('../src/models');
const { calculateFee } = require('../src/utils/feeCalculator');
const { NOTIFICATION_TYPES, ROLES, DOCTOR_STATUS, SLOT_STATUS } = require('../src/config/constants');
const bcrypt = require('bcryptjs');

describe('Milestone 3 Model & Unit Test Suite', () => {
  afterAll(async () => {
    await db.sequelize.close();
  });

  describe('1. Model Registration & Associations', () => {
    test('all 10 models should be registered in Sequelize', () => {
      const expectedModels = [
        'User',
        'DoctorProfile',
        'DoctorCertificate',
        'AvailabilitySlot',
        'Appointment',
        'Prescription',
        'PrescriptionItem',
        'Notification',
        'RescheduleRequest',
        'AppSetting',
      ];
      const registered = Object.keys(db.sequelize.models);
      expectedModels.forEach((m) => {
        expect(registered).toContain(m);
      });
      expect(registered.length).toBe(10);
    });

    test('should have 34 directional associations correctly mapped', () => {
      let count = 0;
      for (const model of Object.values(db.sequelize.models)) {
        count += Object.keys(model.associations).length;
      }
      expect(count).toBe(34); // 32 from M3 + 2 for reviewer/reviewedDoctorProfiles added in M5
    });
  });

  describe('2. AvailabilitySlot Time Validation (Fix 2)', () => {
    test('should reject slot where end_time is earlier than start_time', async () => {
      const slot = db.AvailabilitySlot.build({
        doctor_profile_id: 1,
        slot_date: '2026-11-20',
        start_time: '11:00:00',
        end_time: '10:30:00',
        status: SLOT_STATUS.AVAILABLE,
      });

      await expect(slot.validate()).rejects.toThrow('Slot end time must be later than start time');
    });

    test('should reject slot where end_time equals start_time (zero duration)', async () => {
      const slot = db.AvailabilitySlot.build({
        doctor_profile_id: 1,
        slot_date: '2026-11-20',
        start_time: '10:00:00',
        end_time: '10:00:00',
        status: SLOT_STATUS.AVAILABLE,
      });

      await expect(slot.validate()).rejects.toThrow('Slot end time must be later than start time');
    });

    test('should accept slot where end_time is strictly later than start_time', async () => {
      const slot = db.AvailabilitySlot.build({
        doctor_profile_id: 1,
        slot_date: '2026-11-20',
        start_time: '09:00:00',
        end_time: '09:30:00',
        status: SLOT_STATUS.AVAILABLE,
      });

      await expect(slot.validate()).resolves.toBeDefined();
    });
  });

  describe('3. Notification Types & Coexistence Validation (Fix 1)', () => {
    test('should validate and allow all 9 distinct notification types', async () => {
      const types = Object.values(NOTIFICATION_TYPES);
      expect(types.length).toBe(9);

      for (const type of types) {
        const notification = db.Notification.build({
          user_id: 1,
          appointment_id: 10,
          type,
          title: `Notification for ${type}`,
          message: `Testing message content for ${type}`,
        });
        await expect(notification.validate()).resolves.toBeDefined();
      }
    });

    test('should reject invalid notification type', async () => {
      const notification = db.Notification.build({
        user_id: 1,
        appointment_id: 10,
        type: 'invalid_notification_type',
        title: 'Invalid',
        message: 'Invalid message',
      });

      await expect(notification.validate()).rejects.toThrow('Invalid notification type');
    });

    test('model index should define partial unique constraint for appointment notifications', () => {
      const indexes = db.Notification.options.indexes;
      const partialIndex = indexes.find(
        (idx) => idx.name === 'unique_appointment_notification_type'
      );

      expect(partialIndex).toBeDefined();
      expect(partialIndex.unique).toBe(true);
      expect(partialIndex.fields).toEqual(['user_id', 'appointment_id', 'type']);
    });
  });

  describe('4. User Model Security & Password Handling', () => {
    test('comparePassword should correctly verify bcrypt password', async () => {
      const rawPassword = 'SecurePassword@123';
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(rawPassword, salt);

      const user = db.User.build({
        name: 'Test User',
        email: 'test@example.com',
        password_hash: hash,
        role: ROLES.PATIENT,
      });

      const isValid = await user.comparePassword(rawPassword);
      const isInvalid = await user.comparePassword('WrongPassword');

      expect(isValid).toBe(true);
      expect(isInvalid).toBe(false);
    });

    test('toJSON should strip password_hash from output', () => {
      const user = db.User.build({
        name: 'Test User',
        email: 'test@example.com',
        password_hash: '$2a$10$abcdefghijklmnopqrstuvwxyz123456',
        role: ROLES.PATIENT,
      });

      const json = user.toJSON();
      expect(json.password_hash).toBeUndefined();
      expect(json.email).toBe('test@example.com');
      expect(json.name).toBe('Test User');
    });
  });

  describe('5. Fee Calculator Logic', () => {
    test('should calculate percentage commission correctly', () => {
      // Doctor fee: 600, Commission: 10% -> Commission Amount: 60, Total: 660
      const result = calculateFee(600, 'percentage', 10);
      expect(result.commissionAmount).toBe(60.0);
      expect(result.totalFee).toBe(660.0);
    });

    test('should calculate fixed commission correctly', () => {
      // Doctor fee: 450, Fixed Commission: 50 -> Commission Amount: 50, Total: 500
      const result = calculateFee(450, 'fixed', 50);
      expect(result.commissionAmount).toBe(50.0);
      expect(result.totalFee).toBe(500.0);
    });

    test('should reject invalid commission type', () => {
      expect(() => calculateFee(500, 'unknown_type', 10)).toThrow('Invalid commission type');
    });
  });
});
