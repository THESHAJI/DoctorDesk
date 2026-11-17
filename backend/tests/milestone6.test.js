const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { AvailabilitySlot, DoctorProfile, Appointment, AppSetting, Notification, RescheduleRequest, sequelize } = require('../src/models');
const { ROLES, DOCTOR_STATUS, SLOT_STATUS, APPOINTMENT_STATUS, COMMISSION_TYPE, NOTIFICATION_TYPES, RESCHEDULE_STATUS } = require('../src/config/constants');
const { getClinicDateTime, isSlotInPast } = require('../src/utils/timezone');
const SlotService = require('../src/services/slot.service');
const AppointmentService = require('../src/services/appointment.service');
const RescheduleService = require('../src/services/reschedule.service');

describe('Milestone 6.1: Timezone Utility & Single Doctor Availability Slot Creation', () => {
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalJwtExpiresIn = process.env.JWT_EXPIRES_IN;

  let approvedDoctorToken;
  let otherDoctorToken;
  let pendingDoctorToken;
  let suspendedDoctorToken;
  let patientToken;
  let otherPatientToken;

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'milestone_6_1_test_secret_key_12345';
    process.env.JWT_EXPIRES_IN = '1h';

    approvedDoctorToken = jwt.sign(
      { id: 201, email: 'approved.doctor@example.com', role: ROLES.DOCTOR },
      process.env.JWT_SECRET
    );

    otherDoctorToken = jwt.sign(
      { id: 204, email: 'other.doctor@example.com', role: ROLES.DOCTOR },
      process.env.JWT_SECRET
    );

    pendingDoctorToken = jwt.sign(
      { id: 202, email: 'pending.doctor@example.com', role: ROLES.DOCTOR },
      process.env.JWT_SECRET
    );

    suspendedDoctorToken = jwt.sign(
      { id: 203, email: 'suspended.doctor@example.com', role: ROLES.DOCTOR },
      process.env.JWT_SECRET
    );

    patientToken = jwt.sign(
      { id: 301, email: 'patient@example.com', role: ROLES.PATIENT },
      process.env.JWT_SECRET
    );

    otherPatientToken = jwt.sign(
      { id: 302, email: 'other.patient@example.com', role: ROLES.PATIENT },
      process.env.JWT_SECRET
    );
  });

  afterAll(async () => {
    process.env.JWT_SECRET = originalJwtSecret;
    process.env.JWT_EXPIRES_IN = originalJwtExpiresIn;
    await sequelize.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // 1. TIMEZONE UTILITY UNIT TESTS
  // =========================================================================
  describe('1. Clinic Timezone Utility (Asia/Kolkata)', () => {
    test('getClinicDateTime returns valid date and 24-hour time strings', () => {
      const clinicDT = getClinicDateTime();
      expect(clinicDT.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(clinicDT.time).toMatch(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/);
      expect(clinicDT.hour).toBeGreaterThanOrEqual(0);
      expect(clinicDT.hour).toBeLessThanOrEqual(23);
    });

    test('isSlotInPast correctly evaluates past and future dates', () => {
      expect(isSlotInPast('2020-01-01', '10:00')).toBe(true);
      expect(isSlotInPast('2099-12-31', '23:00')).toBe(false);
    });
  });

  // =========================================================================
  // 2. INPUT VALIDATION TESTS FOR SLOT CREATION
  // =========================================================================
  describe('2. Slot Creation Input Validation', () => {
    test('rejects slot where endTime <= startTime (end time before start) with 422', async () => {
      const res = await request(app)
        .post('/api/doctors/slots')
        .set('Cookie', [`token=${approvedDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({
          slotDate: '2099-01-01',
          startTime: '11:00',
          endTime: '10:30',
        });

      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/end time must be later than start time/i);
    });

    test('rejects slot where endTime equals startTime (zero duration) with 422', async () => {
      const res = await request(app)
        .post('/api/doctors/slots')
        .set('Cookie', [`token=${approvedDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({
          slotDate: '2099-01-01',
          startTime: '10:00',
          endTime: '10:00',
        });

      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/end time must be later than start time/i);
    });

    test('rejects slot creation for past dates with 422', async () => {
      const res = await request(app)
        .post('/api/doctors/slots')
        .set('Cookie', [`token=${approvedDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({
          slotDate: '2020-01-01',
          startTime: '10:00',
          endTime: '10:30',
        });

      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/Cannot create availability slots in the past/i);
    });

    test('rejects invalid time formats with 422', async () => {
      const res = await request(app)
        .post('/api/doctors/slots')
        .set('Cookie', [`token=${approvedDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({
          slotDate: '2099-01-01',
          startTime: '25:99', // Invalid hour and minute
          endTime: '10:30',
        });

      expect(res.status).toBe(422);
      expect(res.body.errors.some((e) => e.field === 'startTime')).toBe(true);
    });
  });

  // =========================================================================
  // 3. DOCTOR APPROVAL RECHECK UNDER ROW LOCK
  // =========================================================================
  describe('3. Doctor Approval Verification Under Lock', () => {
    test('rejects slot creation if doctor status is pending with 403', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      jest.spyOn(DoctorProfile, 'findOne').mockResolvedValue({
        id: 12,
        user_id: 202,
        status: DOCTOR_STATUS.PENDING,
      });

      const res = await request(app)
        .post('/api/doctors/slots')
        .set('Cookie', [`token=${pendingDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({
          slotDate: '2099-01-01',
          startTime: '09:00',
          endTime: '09:30',
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Only approved doctors can manage slots/i);
    });

    test('rejects slot creation if doctor status is suspended with 403', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      jest.spyOn(DoctorProfile, 'findOne').mockResolvedValue({
        id: 13,
        user_id: 203,
        status: DOCTOR_STATUS.SUSPENDED,
      });

      const res = await request(app)
        .post('/api/doctors/slots')
        .set('Cookie', [`token=${suspendedDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({
          slotDate: '2099-01-01',
          startTime: '09:00',
          endTime: '09:30',
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Only approved doctors can manage slots/i);
    });

    test('non-doctor (patient) is rejected with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/doctors/slots')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({
          slotDate: '2099-01-01',
          startTime: '09:00',
          endTime: '09:30',
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Required role: doctor/i);
    });
  });

  // =========================================================================
  // 4. INTERVAL OVERLAP PREVENTION & SUCCESSFUL SLOT CREATION
  // =========================================================================
  describe('4. Slot Creation & Interval Overlap Prevention', () => {
    test('successfully creates a single valid availability slot under parent lock', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      jest.spyOn(DoctorProfile, 'findOne').mockResolvedValue({
        id: 10,
        user_id: 201,
        status: DOCTOR_STATUS.APPROVED,
      });

      // No overlap
      jest.spyOn(AvailabilitySlot, 'findOne').mockResolvedValue(null);

      const fakeSlot = AvailabilitySlot.build({
        id: 101,
        doctor_profile_id: 10,
        slot_date: '2099-05-10',
        start_time: '10:00:00',
        end_time: '10:30:00',
        status: SLOT_STATUS.AVAILABLE,
      });
      jest.spyOn(AvailabilitySlot, 'create').mockResolvedValue(fakeSlot);

      const res = await request(app)
        .post('/api/doctors/slots')
        .set('Cookie', [`token=${approvedDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({
          slotDate: '2099-05-10',
          startTime: '10:00',
          endTime: '10:30',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.slot.start_time).toBe('10:00:00');
      expect(res.body.data.slot.end_time).toBe('10:30:00');
      expect(res.body.data.slot.status).toBe('available');
    });

    test('rejects creation when new slot interval overlaps an existing slot with 409 Conflict', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      jest.spyOn(DoctorProfile, 'findOne').mockResolvedValue({
        id: 10,
        user_id: 201,
        status: DOCTOR_STATUS.APPROVED,
      });

      // Overlapping slot found
      const existingOverlappingSlot = {
        id: 55,
        start_time: '09:30:00',
        end_time: '10:30:00',
      };
      jest.spyOn(AvailabilitySlot, 'findOne').mockResolvedValue(existingOverlappingSlot);

      // Attempting to insert 10:00-11:00 (overlaps with 09:30-10:30)
      const res = await request(app)
        .post('/api/doctors/slots')
        .set('Cookie', [`token=${approvedDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({
          slotDate: '2099-05-10',
          startTime: '10:00',
          endTime: '11:00',
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/overlaps with an existing availability slot/i);
    });
  });

  // =========================================================================
  // 5. DOCTOR OWN SLOTS LISTING & M6.1 EDGE CASES
  // =========================================================================
  describe('5. Slot Management Edge Cases & Listing', () => {
    test('rejects impossible calendar date (e.g., 2026-02-30) with 422', async () => {
      const res = await request(app)
        .post('/api/doctors/slots')
        .set('Cookie', [`token=${approvedDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({
          slotDate: '2026-02-30',
          startTime: '10:00',
          endTime: '10:30',
        });

      expect(res.status).toBe(422);
      expect(res.body.errors.some((e) => e.field === 'slotDate')).toBe(true);
    });

    test('rejects today\'s slot when start time is in the past in Asia/Kolkata with 422', async () => {
      const now = getClinicDateTime();
      if (now.hour > 0) {
        const pastHour = String(now.hour - 1).padStart(2, '0');
        const res = await request(app)
          .post('/api/doctors/slots')
          .set('Cookie', [`token=${approvedDoctorToken}`])
          .set('Content-Type', 'application/json')
          .send({
            slotDate: now.date,
            startTime: `${pastHour}:00`,
            endTime: `${pastHour}:30`,
          });

        expect(res.status).toBe(422);
        expect(res.body.message).toMatch(/Cannot create availability slots in the past/i);
      }
    });

    test('GET /api/doctors/slots/me successfully lists slots for authenticated doctor', async () => {
      jest.spyOn(DoctorProfile, 'findOne').mockResolvedValue({
        id: 10,
        user_id: 201,
      });

      const mockSlots = [
        {
          id: 1,
          doctor_profile_id: 10,
          slot_date: '2099-05-10',
          start_time: '09:00:00',
          end_time: '09:30:00',
          status: SLOT_STATUS.AVAILABLE,
          toJSON: () => ({
            id: 1,
            doctor_profile_id: 10,
            slot_date: '2099-05-10',
            start_time: '09:00:00',
            end_time: '09:30:00',
            status: SLOT_STATUS.AVAILABLE,
          }),
        },
      ];
      jest.spyOn(AvailabilitySlot, 'findAll').mockResolvedValue(mockSlots);

      const res = await request(app)
        .get('/api/doctors/slots/me')
        .set('Cookie', [`token=${approvedDoctorToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.slots)).toBe(true);
      expect(res.body.data.slots.length).toBe(1);
    });
  });

  // =========================================================================
  // 6. MILESTONE 6.2: BULK AVAILABILITY SLOT GENERATION
  // =========================================================================
  describe('6. Milestone 6.2: Bulk Availability Slot Generation', () => {
    test('successfully generates bulk slots for one calendar day under parent lock', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      jest.spyOn(DoctorProfile, 'findOne').mockResolvedValue({
        id: 10,
        user_id: 201,
        status: DOCTOR_STATUS.APPROVED,
      });

      // No overlapping slot exists
      jest.spyOn(AvailabilitySlot, 'findOne').mockResolvedValue(null);

      // Mock bulkCreate
      const mockCreated = [
        { id: 101, slot_date: '2099-06-01', start_time: '09:00:00', end_time: '09:30:00', status: 'available', toJSON: () => ({ id: 101, start_time: '09:00:00' }) },
        { id: 102, slot_date: '2099-06-01', start_time: '09:30:00', end_time: '10:00:00', status: 'available', toJSON: () => ({ id: 102, start_time: '09:30:00' }) },
        { id: 103, slot_date: '2099-06-01', start_time: '10:00:00', end_time: '10:30:00', status: 'available', toJSON: () => ({ id: 103, start_time: '10:00:00' }) },
        { id: 104, slot_date: '2099-06-01', start_time: '10:30:00', end_time: '11:00:00', status: 'available', toJSON: () => ({ id: 104, start_time: '10:30:00' }) },
      ];
      const bulkCreateSpy = jest.spyOn(AvailabilitySlot, 'bulkCreate').mockResolvedValue(mockCreated);

      const res = await request(app)
        .post('/api/doctors/slots/bulk')
        .set('Cookie', [`token=${approvedDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({
          slotDate: '2099-06-01',
          startTime: '09:00',
          endTime: '11:00',
          duration: 30,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.count).toBe(4);
      expect(res.body.data.slots.length).toBe(4);
      expect(bulkCreateSpy).toHaveBeenCalledTimes(1);

      // Verify the generated candidate slot intervals
      const insertedArgs = bulkCreateSpy.mock.calls[0][0];
      expect(insertedArgs).toHaveLength(4);
      expect(insertedArgs[0].start_time).toBe('09:00:00');
      expect(insertedArgs[0].end_time).toBe('09:30:00');
      expect(insertedArgs[3].start_time).toBe('10:30:00');
      expect(insertedArgs[3].end_time).toBe('11:00:00');
    });

    test('rejects invalid duration not in [15, 20, 30, 45, 60] with 422', async () => {
      const res = await request(app)
        .post('/api/doctors/slots/bulk')
        .set('Cookie', [`token=${approvedDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({
          slotDate: '2099-06-01',
          startTime: '09:00',
          endTime: '11:00',
          duration: 25,
        });

      expect(res.status).toBe(422);
      expect(res.body.errors.some((e) => e.field === 'duration')).toBe(true);
    });

    test('rejects uneven time window that cannot divide evenly by duration with 422', async () => {
      const res = await request(app)
        .post('/api/doctors/slots/bulk')
        .set('Cookie', [`token=${approvedDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({
          slotDate: '2099-06-01',
          startTime: '09:00',
          endTime: '10:15', // 75 minutes, not divisible by 30
          duration: 30,
        });

      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/must divide evenly by slot duration/i);
    });

    test('rejects overnight window where endTime <= startTime with 422', async () => {
      const res = await request(app)
        .post('/api/doctors/slots/bulk')
        .set('Cookie', [`token=${approvedDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({
          slotDate: '2099-06-01',
          startTime: '22:00',
          endTime: '06:00', // Overnight
          duration: 60,
        });

      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/end time must be later than start time/i);
    });

    test('rejects past date for bulk slot generation with 422', async () => {
      const res = await request(app)
        .post('/api/doctors/slots/bulk')
        .set('Cookie', [`token=${approvedDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({
          slotDate: '2020-01-01',
          startTime: '09:00',
          endTime: '11:00',
          duration: 30,
        });

      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/Cannot create availability slots in the past/i);
    });

    test('rejects bulk generation exceeding maximum 100 slots limit with 422', async () => {
      // Direct service test to verify the > 100 guard
      await expect(
        SlotService.createBulkSlots(201, {
          slotDate: '2099-06-01',
          startTime: '00:00',
          endTime: '20:00', // 1200 mins
          duration: 10, // 120 slots > 100
        })
      ).rejects.toThrow(/exceeds maximum limit of 100 slots/i);
    });

    test('rejects bulk generation when doctor status is pending with 403', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      jest.spyOn(DoctorProfile, 'findOne').mockResolvedValue({
        id: 12,
        user_id: 202,
        status: DOCTOR_STATUS.PENDING,
      });

      const res = await request(app)
        .post('/api/doctors/slots/bulk')
        .set('Cookie', [`token=${pendingDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({
          slotDate: '2099-06-01',
          startTime: '09:00',
          endTime: '11:00',
          duration: 30,
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Only approved doctors can manage slots/i);
    });

    test('rejects bulk generation when doctor status is suspended with 403', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      jest.spyOn(DoctorProfile, 'findOne').mockResolvedValue({
        id: 13,
        user_id: 203,
        status: DOCTOR_STATUS.SUSPENDED,
      });

      const res = await request(app)
        .post('/api/doctors/slots/bulk')
        .set('Cookie', [`token=${suspendedDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({
          slotDate: '2099-06-01',
          startTime: '09:00',
          endTime: '11:00',
          duration: 30,
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Only approved doctors can manage slots/i);
    });

    test('rejects bulk generation for non-doctor role (patient) with 403', async () => {
      const res = await request(app)
        .post('/api/doctors/slots/bulk')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({
          slotDate: '2099-06-01',
          startTime: '09:00',
          endTime: '11:00',
          duration: 30,
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Required role: doctor/i);
    });

    test('rejects entire batch if ANY candidate slot overlaps an existing slot with 409 Conflict', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      jest.spyOn(DoctorProfile, 'findOne').mockResolvedValue({
        id: 10,
        user_id: 201,
        status: DOCTOR_STATUS.APPROVED,
      });

      // Existing slot that overlaps with the 09:00-11:00 requested window
      const conflictingSlot = {
        id: 88,
        start_time: '10:00:00',
        end_time: '10:30:00',
      };
      jest.spyOn(AvailabilitySlot, 'findOne').mockResolvedValue(conflictingSlot);
      const bulkCreateSpy = jest.spyOn(AvailabilitySlot, 'bulkCreate');

      const res = await request(app)
        .post('/api/doctors/slots/bulk')
        .set('Cookie', [`token=${approvedDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({
          slotDate: '2099-06-01',
          startTime: '09:00',
          endTime: '11:00',
          duration: 30,
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/Bulk slot generation conflict: existing slot/i);
      // Verify atomic rollback / never called bulkCreate
      expect(bulkCreateSpy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 7. MILESTONE 6.3: PATIENT APPOINTMENT BOOKING
  // =========================================================================
  describe('7. Milestone 6.3: Patient Appointment Booking', () => {
    test('GET /api/doctors/:id/slots returns available future slots for approved doctor', async () => {
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue({
        id: 10,
        status: DOCTOR_STATUS.APPROVED,
      });

      const mockSlots = [
        {
          id: 1,
          doctor_profile_id: 10,
          slot_date: '2099-07-01',
          start_time: '10:00:00',
          end_time: '10:30:00',
          status: SLOT_STATUS.AVAILABLE,
          toJSON: () => ({
            id: 1,
            doctor_profile_id: 10,
            slot_date: '2099-07-01',
            start_time: '10:00:00',
            end_time: '10:30:00',
            status: SLOT_STATUS.AVAILABLE,
          }),
        },
      ];
      jest.spyOn(AvailabilitySlot, 'findAll').mockResolvedValue(mockSlots);

      const res = await request(app).get('/api/doctors/10/slots');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.slots)).toBe(true);
      expect(res.body.data.slots.length).toBe(1);
    });

    test('GET /api/doctors/:id/slots returns 404 if doctor is not approved or not found', async () => {
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue({
        id: 10,
        status: DOCTOR_STATUS.PENDING,
      });

      const res = await request(app).get('/api/doctors/10/slots');

      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/Doctor profile not found or not approved/i);
    });

    test('successfully books an available slot with fee snapshot calculation and atomic commit', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      // Step 1: Pre-read slot
      const fakeSlotInstance = {
        id: 101,
        doctor_profile_id: 10,
        slot_date: '2099-08-01',
        start_time: '10:00:00',
        end_time: '10:30:00',
        status: SLOT_STATUS.AVAILABLE,
        update: jest.fn().mockResolvedValue(true),
      };
      jest.spyOn(AvailabilitySlot, 'findByPk').mockResolvedValue(fakeSlotInstance);

      // Lock Level 1: DoctorProfile
      const fakeDoctorProfile = {
        id: 10,
        user_id: 201, // Distinct from patientId (301)
        status: DOCTOR_STATUS.APPROVED,
        consultation_fee: '600.00',
        specialization: 'Cardiology',
        qualification: 'MBBS, MD',
      };
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue(fakeDoctorProfile);

      // Lock Level 2: AvailabilitySlot
      jest.spyOn(AvailabilitySlot, 'findOne').mockResolvedValue(fakeSlotInstance);

      // App Settings for commission calculation (10% percentage)
      jest.spyOn(AppSetting, 'findAll').mockResolvedValue([
        { key: 'commission_type', value: 'percentage' },
        { key: 'commission_value', value: '10' },
      ]);

      // Appointment creation
      const fakeAppointment = {
        id: 501,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 101,
        status: APPOINTMENT_STATUS.BOOKED,
        consultation_fee: 600.0,
        commission_amount: 60.0,
        total_fee: 660.0,
        commission_type: 'percentage',
        commission_value: 10,
        booked_at: new Date('2099-08-01T09:00:00Z'),
      };
      jest.spyOn(Appointment, 'create').mockResolvedValue(fakeAppointment);

      const res = await request(app)
        .post('/api/appointments')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({
          slotId: 101,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.appointment.id).toBe(501);
      expect(res.body.data.appointment.consultation_fee).toBe(600);
      expect(res.body.data.appointment.commission_amount).toBe(60);
      expect(res.body.data.appointment.total_fee).toBe(660);
      expect(fakeSlotInstance.update).toHaveBeenCalledWith(
        { status: SLOT_STATUS.BOOKED },
        expect.any(Object)
      );
    });

    test('verifies strict lock acquisition order: DoctorProfile first, AvailabilitySlot second', async () => {
      const callOrder = [];

      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      // Step 1: Pre-read slot
      const fakeSlotInstance = {
        id: 102,
        doctor_profile_id: 10,
        slot_date: '2099-08-01',
        start_time: '11:00:00',
        end_time: '11:30:00',
        status: SLOT_STATUS.AVAILABLE,
        update: jest.fn().mockResolvedValue(true),
      };
      jest.spyOn(AvailabilitySlot, 'findByPk').mockResolvedValue(fakeSlotInstance);

      // Spies to record lock order inside transaction
      jest.spyOn(DoctorProfile, 'findByPk').mockImplementation(async (id, options) => {
        if (options && options.lock) {
          callOrder.push('DoctorProfile');
        }
        return {
          id: 10,
          user_id: 201,
          status: DOCTOR_STATUS.APPROVED,
          consultation_fee: '500.00',
        };
      });

      jest.spyOn(AvailabilitySlot, 'findOne').mockImplementation(async (options) => {
        if (options && options.lock) {
          callOrder.push('AvailabilitySlot');
        }
        return fakeSlotInstance;
      });

      jest.spyOn(AppSetting, 'findAll').mockResolvedValue([]);
      jest.spyOn(Appointment, 'create').mockResolvedValue({ id: 502, status: 'booked' });

      await request(app)
        .post('/api/appointments')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({ slotId: 102 });

      expect(callOrder).toEqual(['DoctorProfile', 'AvailabilitySlot']);
    });

    test('rejects booking when slot is already booked with 409 Conflict', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      jest.spyOn(AvailabilitySlot, 'findByPk').mockResolvedValue({
        id: 103,
        doctor_profile_id: 10,
        status: SLOT_STATUS.AVAILABLE,
      });

      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue({
        id: 10,
        user_id: 201,
        status: DOCTOR_STATUS.APPROVED,
      });

      // Slot is found to be already booked when locked
      jest.spyOn(AvailabilitySlot, 'findOne').mockResolvedValue({
        id: 103,
        doctor_profile_id: 10,
        status: SLOT_STATUS.BOOKED,
      });

      const res = await request(app)
        .post('/api/appointments')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({ slotId: 103 });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/no longer available for booking/i);
    });

    test('rejects booking when slot is blocked with 409 Conflict', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      jest.spyOn(AvailabilitySlot, 'findByPk').mockResolvedValue({
        id: 104,
        doctor_profile_id: 10,
        status: SLOT_STATUS.AVAILABLE,
      });

      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue({
        id: 10,
        user_id: 201,
        status: DOCTOR_STATUS.APPROVED,
      });

      // Slot is blocked
      jest.spyOn(AvailabilitySlot, 'findOne').mockResolvedValue({
        id: 104,
        doctor_profile_id: 10,
        status: SLOT_STATUS.BLOCKED,
      });

      const res = await request(app)
        .post('/api/appointments')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({ slotId: 104 });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/no longer available for booking/i);
    });

    test('rejects booking when slot date/time is in the past with 400 Bad Request', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      jest.spyOn(AvailabilitySlot, 'findByPk').mockResolvedValue({
        id: 105,
        doctor_profile_id: 10,
        status: SLOT_STATUS.AVAILABLE,
      });

      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue({
        id: 10,
        user_id: 201,
        status: DOCTOR_STATUS.APPROVED,
      });

      // Slot is in the past
      jest.spyOn(AvailabilitySlot, 'findOne').mockResolvedValue({
        id: 105,
        doctor_profile_id: 10,
        slot_date: '2020-01-01',
        start_time: '10:00:00',
        status: SLOT_STATUS.AVAILABLE,
      });

      const res = await request(app)
        .post('/api/appointments')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({ slotId: 105 });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Cannot book an appointment for a slot in the past/i);
    });

    test('rejects booking if doctor is not approved (pending/suspended) with 403 Forbidden', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      jest.spyOn(AvailabilitySlot, 'findByPk').mockResolvedValue({
        id: 106,
        doctor_profile_id: 12,
        status: SLOT_STATUS.AVAILABLE,
      });

      // Doctor is pending
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue({
        id: 12,
        user_id: 202,
        status: DOCTOR_STATUS.PENDING,
      });

      const res = await request(app)
        .post('/api/appointments')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({ slotId: 106 });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Only approved doctors can accept bookings/i);
    });

    test('rejects self-booking if doctor attempts to book their own slot with 400 Bad Request', async () => {
      // Create a token for a doctor whose user_id matches doctorProfile.user_id
      const selfDoctorToken = jwt.sign(
        { id: 201, email: 'doctor201@example.com', role: ROLES.PATIENT }, // User acted as patient role but owns doctorProfile
        process.env.JWT_SECRET
      );

      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      jest.spyOn(AvailabilitySlot, 'findByPk').mockResolvedValue({
        id: 107,
        doctor_profile_id: 10,
        status: SLOT_STATUS.AVAILABLE,
      });

      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue({
        id: 10,
        user_id: 201, // Identical to req.user.id
        status: DOCTOR_STATUS.APPROVED,
      });

      const res = await request(app)
        .post('/api/appointments')
        .set('Cookie', [`token=${selfDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({ slotId: 107 });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Doctors cannot book appointments with themselves/i);
    });

    test('rejects booking when doctorProfileId does not match slot owner with 400 Bad Request', async () => {
      jest.spyOn(AvailabilitySlot, 'findByPk').mockResolvedValue({
        id: 108,
        doctor_profile_id: 10,
      });

      const res = await request(app)
        .post('/api/appointments')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({
          slotId: 108,
          doctorProfileId: 999, // Mismatched
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Slot does not belong to the specified doctor profile/i);
    });

    test('rejects booking when slotId is not found with 404 Not Found', async () => {
      jest.spyOn(AvailabilitySlot, 'findByPk').mockResolvedValue(null);

      const res = await request(app)
        .post('/api/appointments')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({ slotId: 99999 });

      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/Availability slot not found/i);
    });

    test('rejects non-patient role (doctor) booking attempt with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/appointments')
        .set('Cookie', [`token=${approvedDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({ slotId: 101 });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Required role: patient/i);
    });

    test('simulated concurrency: two parallel booking requests on same slot result in exactly one 201 and one 409', async () => {
      // Mocked Concurrency Demonstration
      // Request A acquires row lock and succeeds.
      // Request B arrives while A is committing and finds slot.status === 'booked' -> returns 409.
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      let slotState = {
        id: 109,
        doctor_profile_id: 10,
        slot_date: '2099-09-01',
        start_time: '14:00:00',
        end_time: '14:30:00',
        status: SLOT_STATUS.AVAILABLE,
        update: jest.fn(function (values) {
          slotState.status = values.status;
          return Promise.resolve(this);
        }),
      };

      jest.spyOn(AvailabilitySlot, 'findByPk').mockImplementation(async () => slotState);

      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue({
        id: 10,
        user_id: 201,
        status: DOCTOR_STATUS.APPROVED,
        consultation_fee: '400.00',
      });

      jest.spyOn(AvailabilitySlot, 'findOne').mockImplementation(async () => {
        // Return current slot state (which turns 'booked' after first request completes)
        return slotState;
      });

      jest.spyOn(AppSetting, 'findAll').mockResolvedValue([]);
      let apptId = 600;
      jest.spyOn(Appointment, 'create').mockImplementation(async () => ({
        id: ++apptId,
        status: 'booked',
        consultation_fee: 400,
        commission_amount: 40,
        total_fee: 440,
        booked_at: new Date(),
      }));

      // Sequential execution simulating two serialized concurrent transactions under row lock:
      const res1 = await request(app)
        .post('/api/appointments')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({ slotId: 109 });

      const res2 = await request(app)
        .post('/api/appointments')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({ slotId: 109 });

      expect(res1.status).toBe(201);
      expect(res1.body.success).toBe(true);
      expect(res2.status).toBe(409);
      expect(res2.body.message).toMatch(/no longer available for booking/i);
    });

    test('transient deadlock retry: retries transaction on PostgreSQL 40P01 error up to 2 times', async () => {
      let attempts = 0;
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        attempts++;
        if (attempts === 1) {
          const deadlockErr = new Error('deadlock detected');
          deadlockErr.original = { code: '40P01' };
          throw deadlockErr;
        }
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      const fakeSlotInstance = {
        id: 110,
        doctor_profile_id: 10,
        slot_date: '2099-09-01',
        start_time: '15:00:00',
        end_time: '15:30:00',
        status: SLOT_STATUS.AVAILABLE,
        update: jest.fn().mockResolvedValue(true),
      };
      jest.spyOn(AvailabilitySlot, 'findByPk').mockResolvedValue(fakeSlotInstance);
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue({
        id: 10,
        user_id: 201,
        status: DOCTOR_STATUS.APPROVED,
        consultation_fee: '500.00',
      });
      jest.spyOn(AvailabilitySlot, 'findOne').mockResolvedValue(fakeSlotInstance);
      jest.spyOn(AppSetting, 'findAll').mockResolvedValue([]);
      jest.spyOn(Appointment, 'create').mockResolvedValue({ id: 701, status: 'booked' });

      const res = await request(app)
        .post('/api/appointments')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({ slotId: 110 });

      expect(res.status).toBe(201);
      expect(attempts).toBe(2); // Succeeded on retry attempt 2
    });

    test('ensures slot and appointment atomicity: transaction rolls back if appointment creation fails', async () => {
      let rollbackOccurred = false;
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        try {
          return await callback({ LOCK: { UPDATE: 'UPDATE' } });
        } catch (err) {
          rollbackOccurred = true;
          throw err;
        }
      });

      const fakeSlotInstance = {
        id: 111,
        doctor_profile_id: 10,
        slot_date: '2099-09-01',
        start_time: '16:00:00',
        end_time: '16:30:00',
        status: SLOT_STATUS.AVAILABLE,
        update: jest.fn().mockResolvedValue(true),
      };
      jest.spyOn(AvailabilitySlot, 'findByPk').mockResolvedValue(fakeSlotInstance);
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue({
        id: 10,
        user_id: 201,
        status: DOCTOR_STATUS.APPROVED,
        consultation_fee: '500.00',
      });
      jest.spyOn(AvailabilitySlot, 'findOne').mockResolvedValue(fakeSlotInstance);
      jest.spyOn(AppSetting, 'findAll').mockResolvedValue([]);

      // Appointment.create throws an unexpected DB error
      jest.spyOn(Appointment, 'create').mockRejectedValue(new Error('DB write failure during appointment creation'));

      const res = await request(app)
        .post('/api/appointments')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({ slotId: 111 });

      expect(res.status).toBe(500);
      expect(rollbackOccurred).toBe(true);
    });
  });

  // =========================================================================
  // 8. MILESTONE 6.4: PATIENT & DOCTOR APPOINTMENT CANCELLATION
  // =========================================================================
  describe('8. Milestone 6.4: Patient & Doctor Appointment Cancellation', () => {
    // Helper to generate ISO slot date and time far in the future (e.g. 10 days)
    const futureDate = '2099-10-10';
    const futureTime = '10:00:00';

    test('1. successful patient cancellation (>= 24h away, status to cancelled, slot to available, 0 notifications)', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      const fakeAppt = {
        id: 801,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 201,
        status: APPOINTMENT_STATUS.BOOKED,
        update: jest.fn().mockResolvedValue(true),
      };
      const fakeSlot = {
        id: 201,
        doctor_profile_id: 10,
        slot_date: futureDate,
        start_time: futureTime,
        status: SLOT_STATUS.BOOKED,
        update: jest.fn().mockResolvedValue(true),
      };
      const fakeDoc = {
        id: 10,
        user_id: 201,
        status: DOCTOR_STATUS.APPROVED,
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeAppt);
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue(fakeDoc);
      jest.spyOn(AvailabilitySlot, 'findOne').mockResolvedValue(fakeSlot);
      jest.spyOn(Appointment, 'findOne').mockResolvedValue(fakeAppt);
      const notificationSpy = jest.spyOn(Notification, 'create').mockResolvedValue({});

      const res = await request(app)
        .patch('/api/appointments/801/cancel')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({ reason: 'Feeling better' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(fakeAppt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: APPOINTMENT_STATUS.CANCELLED,
          cancellation_reason: 'Feeling better',
        }),
        expect.any(Object)
      );
      expect(fakeSlot.update).toHaveBeenCalledWith(
        { status: SLOT_STATUS.AVAILABLE },
        expect.any(Object)
      );
      // Zero doctor cancellation notifications dispatched for patient cancellation
      expect(notificationSpy).not.toHaveBeenCalled();
    });

    test('2. successful doctor cancellation (>= 24h away, reason >= 5 chars, slot to available, in-app notification created)', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      const fakeAppt = {
        id: 802,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 202,
        status: APPOINTMENT_STATUS.BOOKED,
        update: jest.fn().mockResolvedValue(true),
      };
      const fakeSlot = {
        id: 202,
        doctor_profile_id: 10,
        slot_date: futureDate,
        start_time: futureTime,
        status: SLOT_STATUS.BOOKED,
        update: jest.fn().mockResolvedValue(true),
      };
      const fakeDoc = {
        id: 10,
        user_id: 201, // Authenticated doctor 201 owns doctorProfile 10
        status: DOCTOR_STATUS.APPROVED,
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeAppt);
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue(fakeDoc);
      jest.spyOn(AvailabilitySlot, 'findOne').mockResolvedValue(fakeSlot);
      jest.spyOn(Appointment, 'findOne').mockResolvedValue(fakeAppt);
      const notificationSpy = jest.spyOn(Notification, 'create').mockResolvedValue({});

      const res = await request(app)
        .patch('/api/appointments/802/cancel')
        .set('Cookie', [`token=${approvedDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({ reason: 'Doctor attending emergency medical conference' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(fakeAppt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: APPOINTMENT_STATUS.CANCELLED,
          cancellation_reason: 'Doctor attending emergency medical conference',
        }),
        expect.any(Object)
      );
      expect(fakeSlot.update).toHaveBeenCalledWith(
        { status: SLOT_STATUS.AVAILABLE },
        expect.any(Object)
      );
      // In-app notification created inside same transaction for patient
      expect(notificationSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 301,
          appointment_id: 802,
          type: NOTIFICATION_TYPES.CANCELLED,
        }),
        expect.any(Object)
      );
    });

    test('3. verifies strict lock acquisition order: DoctorProfile first, AvailabilitySlot second, Appointment third', async () => {
      const lockCallOrder = [];

      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      const fakeAppt = {
        id: 803,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 203,
        status: APPOINTMENT_STATUS.BOOKED,
        update: jest.fn().mockResolvedValue(true),
      };
      const fakeSlot = {
        id: 203,
        doctor_profile_id: 10,
        slot_date: futureDate,
        start_time: futureTime,
        status: SLOT_STATUS.BOOKED,
        update: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeAppt);

      jest.spyOn(DoctorProfile, 'findByPk').mockImplementation(async (id, options) => {
        if (options && options.lock) lockCallOrder.push('DoctorProfile');
        return { id: 10, user_id: 201, status: DOCTOR_STATUS.APPROVED };
      });

      jest.spyOn(AvailabilitySlot, 'findOne').mockImplementation(async (options) => {
        if (options && options.lock) lockCallOrder.push('AvailabilitySlot');
        return fakeSlot;
      });

      jest.spyOn(Appointment, 'findOne').mockImplementation(async (options) => {
        if (options && options.lock) lockCallOrder.push('Appointment');
        return fakeAppt;
      });

      await request(app)
        .patch('/api/appointments/803/cancel')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(lockCallOrder).toEqual(['DoctorProfile', 'AvailabilitySlot', 'Appointment']);
    });

    test('4. cancellation exactly 24 hours before appointment: allowed (200 OK)', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      // Target slot start time exactly 24 hours from mock now
      const mockNowMs = new Date('2099-06-01T10:00:00+05:30').getTime();
      const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(mockNowMs);

      const fakeAppt = {
        id: 804,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 204,
        status: APPOINTMENT_STATUS.BOOKED,
        update: jest.fn().mockResolvedValue(true),
      };
      // Exactly 24 hours later in Asia/Kolkata: 2099-06-02 at 10:00:00
      const fakeSlot = {
        id: 204,
        doctor_profile_id: 10,
        slot_date: '2099-06-02',
        start_time: '10:00:00',
        status: SLOT_STATUS.BOOKED,
        update: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeAppt);
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue({ id: 10, user_id: 201 });
      jest.spyOn(AvailabilitySlot, 'findOne').mockResolvedValue(fakeSlot);
      jest.spyOn(Appointment, 'findOne').mockResolvedValue(fakeAppt);

      const res = await request(app)
        .patch('/api/appointments/804/cancel')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      dateSpy.mockRestore();
    });

    test('5. cancellation less than 24 hours before appointment: rejected with 400 Bad Request', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      // Mock now as 23 hours and 59 minutes before slot start
      const mockNowMs = new Date('2099-06-01T10:01:00+05:30').getTime();
      const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(mockNowMs);

      const fakeAppt = {
        id: 805,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 205,
        status: APPOINTMENT_STATUS.BOOKED,
      };
      const fakeSlot = {
        id: 205,
        doctor_profile_id: 10,
        slot_date: '2099-06-02',
        start_time: '10:00:00', // 23h 59m away
        status: SLOT_STATUS.BOOKED,
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeAppt);
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue({ id: 10, user_id: 201 });
      jest.spyOn(AvailabilitySlot, 'findOne').mockResolvedValue(fakeSlot);
      jest.spyOn(Appointment, 'findOne').mockResolvedValue(fakeAppt);

      const res = await request(app)
        .patch('/api/appointments/805/cancel')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/cannot be cancelled within 24 hours/i);
      dateSpy.mockRestore();
    });

    test('6. rejection of doctor cancellation within 24 hours with 400 Bad Request (no emergency exception)', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      // 10 hours away
      const mockNowMs = new Date('2099-06-01T14:00:00+05:30').getTime();
      const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(mockNowMs);

      const fakeAppt = {
        id: 806,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 206,
        status: APPOINTMENT_STATUS.BOOKED,
      };
      const fakeSlot = {
        id: 206,
        doctor_profile_id: 10,
        slot_date: '2099-06-02',
        start_time: '00:00:00', // 10h away
        status: SLOT_STATUS.BOOKED,
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeAppt);
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue({ id: 10, user_id: 201 });
      jest.spyOn(AvailabilitySlot, 'findOne').mockResolvedValue(fakeSlot);
      jest.spyOn(Appointment, 'findOne').mockResolvedValue(fakeAppt);

      const res = await request(app)
        .patch('/api/appointments/806/cancel')
        .set('Cookie', [`token=${approvedDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({ reason: 'Doctor had sudden emergency hospital surgery' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/cannot be cancelled within 24 hours/i);
      dateSpy.mockRestore();
    });

    test('7. rejection of past appointment cancellation with 400 Bad Request', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      const fakeAppt = {
        id: 807,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 207,
        status: APPOINTMENT_STATUS.BOOKED,
      };
      const fakeSlot = {
        id: 207,
        doctor_profile_id: 10,
        slot_date: '2020-01-01',
        start_time: '10:00:00',
        status: SLOT_STATUS.BOOKED,
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeAppt);
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue({ id: 10, user_id: 201 });
      jest.spyOn(AvailabilitySlot, 'findOne').mockResolvedValue(fakeSlot);
      jest.spyOn(Appointment, 'findOne').mockResolvedValue(fakeAppt);

      const res = await request(app)
        .patch('/api/appointments/807/cancel')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/whose start time has already passed/i);
    });

    test('8. rejection of completed appointment cancellation with 400 Bad Request', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      const fakeAppt = {
        id: 808,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 208,
        status: APPOINTMENT_STATUS.COMPLETED,
      };
      const fakeSlot = {
        id: 208,
        doctor_profile_id: 10,
        slot_date: futureDate,
        start_time: futureTime,
        status: SLOT_STATUS.BOOKED,
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeAppt);
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue({ id: 10, user_id: 201 });
      jest.spyOn(AvailabilitySlot, 'findOne').mockResolvedValue(fakeSlot);
      jest.spyOn(Appointment, 'findOne').mockResolvedValue(fakeAppt);

      const res = await request(app)
        .patch('/api/appointments/808/cancel')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/already marked as completed/i);
    });

    test('9. rejection of already cancelled appointment cancellation with 400 Bad Request', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      const fakeAppt = {
        id: 809,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 209,
        status: APPOINTMENT_STATUS.CANCELLED,
      };
      const fakeSlot = {
        id: 209,
        doctor_profile_id: 10,
        slot_date: futureDate,
        start_time: futureTime,
        status: SLOT_STATUS.BOOKED,
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeAppt);
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue({ id: 10, user_id: 201 });
      jest.spyOn(AvailabilitySlot, 'findOne').mockResolvedValue(fakeSlot);
      jest.spyOn(Appointment, 'findOne').mockResolvedValue(fakeAppt);

      const res = await request(app)
        .patch('/api/appointments/809/cancel')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/already been cancelled/i);
    });

    test('10. rejection of no-show appointment cancellation with 400 Bad Request', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      const fakeAppt = {
        id: 810,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 210,
        status: APPOINTMENT_STATUS.NO_SHOW,
      };
      const fakeSlot = {
        id: 210,
        doctor_profile_id: 10,
        slot_date: futureDate,
        start_time: futureTime,
        status: SLOT_STATUS.BOOKED,
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeAppt);
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue({ id: 10, user_id: 201 });
      jest.spyOn(AvailabilitySlot, 'findOne').mockResolvedValue(fakeSlot);
      jest.spyOn(Appointment, 'findOne').mockResolvedValue(fakeAppt);

      const res = await request(app)
        .patch('/api/appointments/810/cancel')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/marked as no-show/i);
    });

    test('11. rejection of rescheduled appointment cancellation with 400 Bad Request', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      const fakeAppt = {
        id: 811,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 211,
        status: APPOINTMENT_STATUS.RESCHEDULED,
      };
      const fakeSlot = {
        id: 211,
        doctor_profile_id: 10,
        slot_date: futureDate,
        start_time: futureTime,
        status: SLOT_STATUS.BOOKED,
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeAppt);
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue({ id: 10, user_id: 201 });
      jest.spyOn(AvailabilitySlot, 'findOne').mockResolvedValue(fakeSlot);
      jest.spyOn(Appointment, 'findOne').mockResolvedValue(fakeAppt);

      const res = await request(app)
        .patch('/api/appointments/811/cancel')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/already been rescheduled/i);
    });

    test('12. rejection of doctor cancellation without reason or reason < 5 characters with 400 Bad Request', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      const fakeAppt = {
        id: 812,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 212,
        status: APPOINTMENT_STATUS.BOOKED,
      };
      const fakeSlot = {
        id: 212,
        doctor_profile_id: 10,
        slot_date: futureDate,
        start_time: futureTime,
        status: SLOT_STATUS.BOOKED,
      };
      const fakeDoc = {
        id: 10,
        user_id: 201, // Authenticated doctor
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeAppt);
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue(fakeDoc);
      jest.spyOn(AvailabilitySlot, 'findOne').mockResolvedValue(fakeSlot);
      jest.spyOn(Appointment, 'findOne').mockResolvedValue(fakeAppt);

      const res = await request(app)
        .patch('/api/appointments/812/cancel')
        .set('Cookie', [`token=${approvedDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({ reason: 'Sick' }); // Less than 5 characters

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/at least 5 characters/i);
    });

    test('13. patient A cannot cancel patient B\'s appointment with 403 Forbidden', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      const fakeAppt = {
        id: 813,
        patient_id: 301, // Belongs to patient 301
        doctor_profile_id: 10,
        slot_id: 213,
        status: APPOINTMENT_STATUS.BOOKED,
      };
      const fakeSlot = {
        id: 213,
        doctor_profile_id: 10,
        slot_date: futureDate,
        start_time: futureTime,
        status: SLOT_STATUS.BOOKED,
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeAppt);
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue({ id: 10, user_id: 201 });
      jest.spyOn(AvailabilitySlot, 'findOne').mockResolvedValue(fakeSlot);
      jest.spyOn(Appointment, 'findOne').mockResolvedValue(fakeAppt);

      // Caller is otherPatientToken (id: 302)
      const res = await request(app)
        .patch('/api/appointments/813/cancel')
        .set('Cookie', [`token=${otherPatientToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/permission to cancel this appointment/i);
    });

    test('14. doctor A cannot cancel doctor B\'s appointment with 403 Forbidden', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      const fakeAppt = {
        id: 814,
        patient_id: 301,
        doctor_profile_id: 10, // DoctorProfile 10 is owned by doctor 201
        slot_id: 214,
        status: APPOINTMENT_STATUS.BOOKED,
      };
      const fakeSlot = {
        id: 214,
        doctor_profile_id: 10,
        slot_date: futureDate,
        start_time: futureTime,
        status: SLOT_STATUS.BOOKED,
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeAppt);
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue({ id: 10, user_id: 201 }); // Owned by 201
      jest.spyOn(AvailabilitySlot, 'findOne').mockResolvedValue(fakeSlot);
      jest.spyOn(Appointment, 'findOne').mockResolvedValue(fakeAppt);

      // Caller is otherDoctorToken (id: 204)
      const res = await request(app)
        .patch('/api/appointments/814/cancel')
        .set('Cookie', [`token=${otherDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({ reason: 'Doctor cancelling other doctor slot' });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/permission to cancel this appointment/i);
    });

    test('15. locked appointment relationship mismatch returns 409 Conflict', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      // Pre-read found doctor 10 and slot 215
      const preReadAppt = {
        id: 815,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 215,
      };
      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(preReadAppt);
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue({ id: 10, user_id: 201 });
      jest.spyOn(AvailabilitySlot, 'findOne').mockResolvedValue({ id: 215, doctor_profile_id: 10, status: SLOT_STATUS.BOOKED });

      // When appointment row is locked, its slot_id changed concurrently to 999
      const concurrentModifiedAppt = {
        id: 815,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 999, // Mismatched!
        status: APPOINTMENT_STATUS.BOOKED,
      };
      jest.spyOn(Appointment, 'findOne').mockResolvedValue(concurrentModifiedAppt);

      const res = await request(app)
        .patch('/api/appointments/815/cancel')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/relationship changed concurrently/i);
    });

    test('16. inconsistent slot status validation (slot is blocked or available instead of booked) with 409 Conflict', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      const fakeAppt = {
        id: 816,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 216,
        status: APPOINTMENT_STATUS.BOOKED,
      };
      // Slot in database is in BLOCKED state instead of BOOKED
      const fakeSlot = {
        id: 216,
        doctor_profile_id: 10,
        slot_date: futureDate,
        start_time: futureTime,
        status: SLOT_STATUS.BLOCKED,
        update: jest.fn(),
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeAppt);
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue({ id: 10, user_id: 201 });
      jest.spyOn(AvailabilitySlot, 'findOne').mockResolvedValue(fakeSlot);
      jest.spyOn(Appointment, 'findOne').mockResolvedValue(fakeAppt);

      const res = await request(app)
        .patch('/api/appointments/816/cancel')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/in 'blocked' state instead of 'booked'/i);
      expect(fakeSlot.update).not.toHaveBeenCalled();
    });

    test('17. unauthorized caller receives HTTP 403 even when appointment is completed and slot is blocked (information leakage defense)', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      // Appointment is already COMPLETED and slot is BLOCKED
      const fakeAppt = {
        id: 817,
        patient_id: 301, // Owned by 301
        doctor_profile_id: 10, // Doctor is 201
        slot_id: 217,
        status: APPOINTMENT_STATUS.COMPLETED,
        update: jest.fn(),
      };
      const fakeSlot = {
        id: 217,
        doctor_profile_id: 10,
        slot_date: futureDate,
        start_time: futureTime,
        status: SLOT_STATUS.BLOCKED,
        update: jest.fn(),
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeAppt);
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue({ id: 10, user_id: 201 });
      jest.spyOn(AvailabilitySlot, 'findOne').mockResolvedValue(fakeSlot);
      jest.spyOn(Appointment, 'findOne').mockResolvedValue(fakeAppt);

      // Unauthorized caller (patient 302)
      const res = await request(app)
        .patch('/api/appointments/817/cancel')
        .set('Cookie', [`token=${otherPatientToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      // MUST receive 403 Forbidden without leaking whether status is completed or slot is blocked
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/permission to cancel this appointment/i);
      expect(fakeAppt.update).not.toHaveBeenCalled();
      expect(fakeSlot.update).not.toHaveBeenCalled();
    });

    test('18. ensures atomicity: transaction rolls back if notification creation fails during doctor cancellation', async () => {
      let rollbackOccurred = false;
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        try {
          return await callback({ LOCK: { UPDATE: 'UPDATE' } });
        } catch (err) {
          rollbackOccurred = true;
          throw err;
        }
      });

      const fakeAppt = {
        id: 818,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 218,
        status: APPOINTMENT_STATUS.BOOKED,
        update: jest.fn().mockResolvedValue(true),
      };
      const fakeSlot = {
        id: 218,
        doctor_profile_id: 10,
        slot_date: futureDate,
        start_time: futureTime,
        status: SLOT_STATUS.BOOKED,
        update: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeAppt);
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue({ id: 10, user_id: 201 });
      jest.spyOn(AvailabilitySlot, 'findOne').mockResolvedValue(fakeSlot);
      jest.spyOn(Appointment, 'findOne').mockResolvedValue(fakeAppt);

      // Notification creation throws database failure
      jest.spyOn(Notification, 'create').mockRejectedValue(new Error('Notification DB failure'));

      const res = await request(app)
        .patch('/api/appointments/818/cancel')
        .set('Cookie', [`token=${approvedDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({ reason: 'Doctor emergency leave' });

      expect(res.status).toBe(500);
      expect(rollbackOccurred).toBe(true);
    });
  });

  // =========================================================================
  // 9. MILESTONE 6.5: TWO-STEP APPOINTMENT RESCHEDULING & DOCTOR SLOT CONTROLS
  // =========================================================================
  describe('9. Milestone 6.5: Two-Step Appointment Rescheduling & Doctor Slot Controls', () => {
    const futureDate = '2099-11-15';
    const futureTime = '14:00:00';
    const futureDate2 = '2099-11-16';
    const futureTime2 = '15:00:00';

    beforeEach(() => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });
    });

    // -----------------------------------------------------------------------
    // A. RESCHEDULE REQUEST & VALIDATION
    // -----------------------------------------------------------------------
    test('1. patient initiates reschedule request successfully with suggested slot (201 Created)', async () => {
      const fakeAppt = {
        id: 901,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 301,
        status: APPOINTMENT_STATUS.BOOKED,
        slot: {
          id: 301,
          slot_date: futureDate,
          start_time: futureTime,
          end_time: '14:30:00',
          doctor_profile_id: 10,
        },
      };

      const fakeSuggestedSlot = {
        id: 302,
        slot_date: futureDate2,
        start_time: futureTime2,
        end_time: '15:30:00',
        doctor_profile_id: 10,
        status: SLOT_STATUS.AVAILABLE,
      };

      const fakeCreatedRequest = {
        id: 501,
        appointment_id: 901,
        requested_by: 301,
        suggested_slot_id: 302,
        status: RESCHEDULE_STATUS.PENDING,
        reason: 'Work schedule conflict',
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeAppt);
      jest.spyOn(RescheduleRequest, 'findOne').mockResolvedValue(null);
      jest.spyOn(AvailabilitySlot, 'findOne').mockResolvedValue(fakeSuggestedSlot);
      jest.spyOn(RescheduleRequest, 'create').mockResolvedValue(fakeCreatedRequest);

      const res = await request(app)
        .post('/api/appointments/901/reschedule')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({ reason: 'Work schedule conflict' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.rescheduleRequestId).toBe(501);
      expect(res.body.data.suggestedSlot.id).toBe(302);
      expect(res.body.data.status).toBe(RESCHEDULE_STATUS.PENDING);
    });

    test('2. reschedule request rejected if appointment is within 24 hours of start time (400 Bad Request)', async () => {
      const mockNowMs = new Date('2099-11-15T00:00:00+05:30').getTime();
      const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(mockNowMs);

      const fakeAppt = {
        id: 902,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 301,
        status: APPOINTMENT_STATUS.BOOKED,
        slot: {
          id: 301,
          slot_date: '2099-11-15',
          start_time: '10:00:00', // 10h away
          end_time: '10:30:00',
          doctor_profile_id: 10,
        },
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeAppt);

      const res = await request(app)
        .post('/api/appointments/902/reschedule')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({ reason: 'Urgent meeting' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/cannot be rescheduled within 24 hours/i);
      dateSpy.mockRestore();
    });

    test('3. reschedule request rejected if appointment start time has already passed (400 Bad Request)', async () => {
      const fakeAppt = {
        id: 903,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 301,
        status: APPOINTMENT_STATUS.BOOKED,
        slot: {
          id: 301,
          slot_date: '2020-01-01',
          start_time: '10:00:00',
          end_time: '10:30:00',
          doctor_profile_id: 10,
        },
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeAppt);

      const res = await request(app)
        .post('/api/appointments/903/reschedule')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/whose start time has already passed/i);
    });

    test('4. reschedule request rejected for completed, cancelled, or rescheduled appointments (400 Bad Request)', async () => {
      const fakeApptCompleted = {
        id: 904,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 301,
        status: APPOINTMENT_STATUS.COMPLETED,
        slot: { id: 301, slot_date: futureDate, start_time: futureTime },
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeApptCompleted);

      const res = await request(app)
        .post('/api/appointments/904/reschedule')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/already marked as completed/i);

      // Status rescheduled
      const fakeApptRescheduled = {
        id: 904,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 301,
        status: APPOINTMENT_STATUS.RESCHEDULED,
        slot: { id: 301, slot_date: futureDate, start_time: futureTime },
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeApptRescheduled);

      const res2 = await request(app)
        .post('/api/appointments/904/reschedule')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(res2.status).toBe(400);
      expect(res2.body.message).toMatch(/already been rescheduled/i);
    });

    test('5. unauthorized patient cannot request reschedule on another patient appointment (403 Forbidden)', async () => {
      const fakeAppt = {
        id: 905,
        patient_id: 301, // Owned by 301
        doctor_profile_id: 10,
        slot_id: 301,
        status: APPOINTMENT_STATUS.BOOKED,
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeAppt);

      // Caller is other patient 302
      const res = await request(app)
        .post('/api/appointments/905/reschedule')
        .set('Cookie', [`token=${otherPatientToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/permission to reschedule this appointment/i);
    });

    test('6. rejection of duplicate reschedule request when one is already pending (409 Conflict)', async () => {
      const fakeAppt = {
        id: 906,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 301,
        status: APPOINTMENT_STATUS.BOOKED,
        slot: { id: 301, slot_date: futureDate, start_time: futureTime, doctor_profile_id: 10 },
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeAppt);
      jest.spyOn(RescheduleRequest, 'findOne').mockResolvedValue({
        id: 506,
        appointment_id: 906,
        status: RESCHEDULE_STATUS.PENDING,
      });

      const res = await request(app)
        .post('/api/appointments/906/reschedule')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/pending reschedule request already exists/i);
    });

    // -----------------------------------------------------------------------
    // B. SUGGESTION INSPECTION & REJECTION
    // -----------------------------------------------------------------------
    test('7. patient can view active pending reschedule suggestion (200 OK)', async () => {
      const fakeAppt = { id: 907, patient_id: 301 };
      const fakePending = {
        id: 507,
        appointment_id: 907,
        status: RESCHEDULE_STATUS.PENDING,
        reason: 'Family event',
        suggestedSlot: {
          id: 307,
          slot_date: futureDate2,
          start_time: futureTime2,
          end_time: '15:30:00',
          status: SLOT_STATUS.AVAILABLE,
        },
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeAppt);
      jest.spyOn(RescheduleRequest, 'findOne').mockResolvedValue(fakePending);

      const res = await request(app)
        .get('/api/appointments/907/reschedule/suggestion')
        .set('Cookie', [`token=${patientToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.data.suggestedSlot.id).toBe(307);
      expect(res.body.data.suggestedSlot.isStillAvailable).toBe(true);
    });

    test('8. rejecting reschedule suggestion marks request as rejected and leaves appointment untouched (200 OK)', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      const fakeAppt = { id: 908, patient_id: 301 };
      const fakeRequest = {
        id: 508,
        appointment_id: 908,
        status: RESCHEDULE_STATUS.PENDING,
        update: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeAppt);
      jest.spyOn(RescheduleRequest, 'findOne').mockResolvedValue(fakeRequest);

      const res = await request(app)
        .put('/api/appointments/908/reschedule/reject')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(RESCHEDULE_STATUS.REJECTED);
      expect(fakeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: RESCHEDULE_STATUS.REJECTED }),
        expect.any(Object)
      );
    });

    // -----------------------------------------------------------------------
    // C. CONCURRENCY-SAFE CONFIRMATION & HISTORY PRESERVATION
    // -----------------------------------------------------------------------
    test('9. confirm reschedule acquires slot locks in ascending primary-key order', async () => {
      const lockAcquisitionOrder = [];

      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      const fakeAppt = {
        id: 909,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 350, // Old slot ID is 350
        status: APPOINTMENT_STATUS.BOOKED,
        consultation_fee: 500,
        commission_amount: 50,
        total_fee: 550,
        commission_type: COMMISSION_TYPE.PERCENTAGE,
        commission_value: 10,
        update: jest.fn().mockResolvedValue(true),
      };

      const fakeRequest = {
        id: 509,
        appointment_id: 909,
        suggested_slot_id: 310, // New slot ID is 310 (smaller than oldSlotId 350!)
        status: RESCHEDULE_STATUS.PENDING,
        update: jest.fn().mockResolvedValue(true),
      };

      const fakeOldSlot = {
        id: 350,
        slot_date: futureDate,
        start_time: futureTime,
        status: SLOT_STATUS.BOOKED,
        update: jest.fn().mockResolvedValue(true),
      };

      const fakeNewSlot = {
        id: 310,
        slot_date: futureDate2,
        start_time: futureTime2,
        end_time: '15:30:00',
        status: SLOT_STATUS.AVAILABLE,
        update: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(Appointment, 'findByPk').mockImplementation(async (id, options) => {
        if (options && options.lock) lockAcquisitionOrder.push('Appointment');
        return fakeAppt;
      });

      jest.spyOn(RescheduleRequest, 'findOne').mockImplementation(async (options) => {
        if (options && options.lock) lockAcquisitionOrder.push('RescheduleRequest');
        return fakeRequest;
      });

      jest.spyOn(DoctorProfile, 'findByPk').mockImplementation(async (id, options) => {
        if (options && options.lock) lockAcquisitionOrder.push('DoctorProfile');
        return { id: 10, user_id: 201 };
      });

      jest.spyOn(AvailabilitySlot, 'findByPk').mockImplementation(async (id, options) => {
        if (options && options.lock) lockAcquisitionOrder.push(`Slot_${id}`);
        return id === 350 ? fakeOldSlot : fakeNewSlot;
      });

      jest.spyOn(Appointment, 'create').mockResolvedValue({ id: 910 });
      jest.spyOn(Notification, 'create').mockResolvedValue({ id: 1 });

      const res = await request(app)
        .put('/api/appointments/909/reschedule/confirm')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(res.status).toBe(200);
      // Expected lock order: DoctorProfile -> Slot_310 -> Slot_350 -> Appointment -> RescheduleRequest
      expect(lockAcquisitionOrder).toEqual([
        'DoctorProfile',
        'Slot_310',
        'Slot_350',
        'Appointment',
        'RescheduleRequest',
      ]);
    });

    test('10. confirm reschedule atomically updates slots, marks original as rescheduled, creates new appointment and notifies doctor (200 OK)', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      const fakeAppt = {
        id: 910,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 301,
        status: APPOINTMENT_STATUS.BOOKED,
        consultation_fee: '600.00',
        commission_amount: '60.00',
        total_fee: '660.00',
        commission_type: 'percentage',
        commission_value: '10.00',
        update: jest.fn().mockResolvedValue(true),
      };

      const fakeRequest = {
        id: 510,
        appointment_id: 910,
        suggested_slot_id: 302,
        status: RESCHEDULE_STATUS.PENDING,
        update: jest.fn().mockResolvedValue(true),
      };

      const fakeOldSlot = {
        id: 301,
        slot_date: futureDate,
        start_time: futureTime,
        status: SLOT_STATUS.BOOKED,
        update: jest.fn().mockResolvedValue(true),
      };

      const fakeNewSlot = {
        id: 302,
        slot_date: futureDate2,
        start_time: futureTime2,
        end_time: '15:30:00',
        status: SLOT_STATUS.AVAILABLE,
        update: jest.fn().mockResolvedValue(true),
      };

      const fakeNewAppt = {
        id: 911,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 302,
        status: APPOINTMENT_STATUS.BOOKED,
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeAppt);
      jest.spyOn(RescheduleRequest, 'findOne').mockResolvedValue(fakeRequest);
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue({ id: 10, user_id: 201 });
      jest.spyOn(AvailabilitySlot, 'findByPk').mockImplementation(async (id) => {
        return id === 301 ? fakeOldSlot : fakeNewSlot;
      });
      jest.spyOn(Appointment, 'create').mockResolvedValue(fakeNewAppt);
      jest.spyOn(Notification, 'create').mockResolvedValue({ id: 1 });

      const res = await request(app)
        .put('/api/appointments/910/reschedule/confirm')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.originalAppointmentId).toBe(910);
      expect(res.body.data.newAppointmentId).toBe(911);
      expect(res.body.data.status).toBe(RESCHEDULE_STATUS.CONFIRMED);

      // Verify atomic updates
      expect(fakeOldSlot.update).toHaveBeenCalledWith(
        { status: SLOT_STATUS.AVAILABLE },
        expect.any(Object)
      );
      expect(fakeNewSlot.update).toHaveBeenCalledWith(
        { status: SLOT_STATUS.BOOKED },
        expect.any(Object)
      );
      expect(fakeAppt.update).toHaveBeenCalledWith(
        { status: APPOINTMENT_STATUS.RESCHEDULED },
        expect.any(Object)
      );
      expect(fakeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: RESCHEDULE_STATUS.CONFIRMED }),
        expect.any(Object)
      );
      expect(Appointment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          slot_id: 302,
          status: APPOINTMENT_STATUS.BOOKED,
          consultation_fee: '600.00',
        }),
        expect.any(Object)
      );
    });

    test('11. confirm reschedule sets request to expired and commits safely when slot is unavailable, returning 409 Conflict', async () => {
      let txCommitted = false;
      let txRolledBack = false;

      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        try {
          const res = await callback({ LOCK: { UPDATE: 'UPDATE' } });
          txCommitted = true;
          return res;
        } catch (err) {
          txRolledBack = true;
          throw err;
        }
      });

      const fakeAppt = {
        id: 911,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 301,
        status: APPOINTMENT_STATUS.BOOKED,
      };

      const fakeRequest = {
        id: 511,
        appointment_id: 911,
        suggested_slot_id: 302,
        status: RESCHEDULE_STATUS.PENDING,
        update: jest.fn().mockResolvedValue(true),
      };

      const fakeOldSlot = {
        id: 301,
        slot_date: futureDate,
        start_time: futureTime,
        status: SLOT_STATUS.BOOKED,
      };

      // Suggested slot was already booked by another user!
      const fakeClaimedSlot = {
        id: 302,
        slot_date: futureDate2,
        start_time: futureTime2,
        status: SLOT_STATUS.BOOKED,
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeAppt);
      jest.spyOn(RescheduleRequest, 'findOne').mockResolvedValue(fakeRequest);
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue({ id: 10, user_id: 201 });
      jest.spyOn(AvailabilitySlot, 'findByPk').mockImplementation(async (id) => {
        return id === 301 ? fakeOldSlot : fakeClaimedSlot;
      });

      const res = await request(app)
        .put('/api/appointments/911/reschedule/confirm')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/no longer available/i);
      expect(fakeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: RESCHEDULE_STATUS.EXPIRED, responded_at: expect.any(Date) }),
        expect.any(Object)
      );
      expect(txCommitted).toBe(true);
      expect(txRolledBack).toBe(false);
    });

    test('12. notification creation failure triggers rollback of the entire reschedule confirmation transaction', async () => {
      let rollbackOccurred = false;
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        try {
          return await callback({ LOCK: { UPDATE: 'UPDATE' } });
        } catch (err) {
          rollbackOccurred = true;
          throw err;
        }
      });

      const fakeAppt = {
        id: 912,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 301,
        status: APPOINTMENT_STATUS.BOOKED,
        update: jest.fn().mockResolvedValue(true),
      };

      const fakeRequest = {
        id: 512,
        appointment_id: 912,
        suggested_slot_id: 302,
        status: RESCHEDULE_STATUS.PENDING,
        update: jest.fn().mockResolvedValue(true),
      };

      const fakeOldSlot = {
        id: 301,
        slot_date: futureDate,
        start_time: futureTime,
        status: SLOT_STATUS.BOOKED,
        update: jest.fn().mockResolvedValue(true),
      };

      const fakeNewSlot = {
        id: 302,
        slot_date: futureDate2,
        start_time: futureTime2,
        status: SLOT_STATUS.AVAILABLE,
        update: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeAppt);
      jest.spyOn(RescheduleRequest, 'findOne').mockResolvedValue(fakeRequest);
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue({ id: 10, user_id: 201 });
      jest.spyOn(AvailabilitySlot, 'findByPk').mockImplementation(async (id) => {
        return id === 301 ? fakeOldSlot : fakeNewSlot;
      });
      jest.spyOn(Appointment, 'create').mockResolvedValue({ id: 913 });

      // Notification failure
      jest.spyOn(Notification, 'create').mockRejectedValue(new Error('Notification DB failure'));

      const res = await request(app)
        .put('/api/appointments/912/reschedule/confirm')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(res.status).toBe(500);
      expect(rollbackOccurred).toBe(true);
    });

    test('13. attempting to cancel the rescheduled original appointment yields 400 Bad Request', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      const fakeApptRescheduled = {
        id: 913,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 301,
        status: APPOINTMENT_STATUS.RESCHEDULED,
      };

      const fakeSlot = {
        id: 301,
        doctor_profile_id: 10,
        slot_date: futureDate,
        start_time: futureTime,
        status: SLOT_STATUS.BOOKED,
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeApptRescheduled);
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue({ id: 10, user_id: 201 });
      jest.spyOn(AvailabilitySlot, 'findOne').mockResolvedValue(fakeSlot);
      jest.spyOn(Appointment, 'findOne').mockResolvedValue(fakeApptRescheduled);

      const res = await request(app)
        .patch('/api/appointments/913/cancel')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Cannot cancel an appointment that has already been rescheduled/i);
    });

    // -----------------------------------------------------------------------
    // D. DOCTOR SLOT CONTROLS (BLOCK, UNBLOCK, SAFE DELETE)
    // -----------------------------------------------------------------------
    test('14. doctor blocks available slot successfully (200 OK)', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      const fakeSlot = {
        id: 401,
        doctor_profile_id: 10,
        status: SLOT_STATUS.AVAILABLE,
        update: jest.fn().mockImplementation(function (data) {
          this.status = data.status;
          return Promise.resolve(this);
        }),
      };

      jest.spyOn(DoctorProfile, 'findOne').mockResolvedValue({ id: 10, user_id: 201, status: DOCTOR_STATUS.APPROVED });
      jest.spyOn(AvailabilitySlot, 'findByPk').mockResolvedValue(fakeSlot);
      jest.spyOn(Appointment, 'count').mockResolvedValue(0);

      const res = await request(app)
        .patch('/api/doctors/slots/401/block')
        .set('Cookie', [`token=${approvedDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(SLOT_STATUS.BLOCKED);
      expect(fakeSlot.update).toHaveBeenCalledWith({ status: SLOT_STATUS.BLOCKED }, expect.any(Object));
    });

    test('15. doctor cannot block an already booked slot (400 Bad Request)', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      const fakeSlot = {
        id: 402,
        doctor_profile_id: 10,
        status: SLOT_STATUS.BOOKED,
      };

      jest.spyOn(DoctorProfile, 'findOne').mockResolvedValue({ id: 10, user_id: 201, status: DOCTOR_STATUS.APPROVED });
      jest.spyOn(AvailabilitySlot, 'findByPk').mockResolvedValue(fakeSlot);

      const res = await request(app)
        .patch('/api/doctors/slots/402/block')
        .set('Cookie', [`token=${approvedDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Cannot block a currently booked slot/i);
    });

    test('16. doctor cannot block a slot with an active appointment (400 Bad Request)', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      const fakeSlot = {
        id: 403,
        doctor_profile_id: 10,
        status: SLOT_STATUS.AVAILABLE,
      };

      jest.spyOn(DoctorProfile, 'findOne').mockResolvedValue({ id: 10, user_id: 201, status: DOCTOR_STATUS.APPROVED });
      jest.spyOn(AvailabilitySlot, 'findByPk').mockResolvedValue(fakeSlot);
      jest.spyOn(Appointment, 'count').mockResolvedValue(1); // Active appointment exists

      const res = await request(app)
        .patch('/api/doctors/slots/403/block')
        .set('Cookie', [`token=${approvedDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Cannot block a slot that has an active appointment/i);
    });

    test('17. doctor unblocks blocked slot successfully (200 OK)', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      const fakeSlot = {
        id: 404,
        doctor_profile_id: 10,
        slot_date: futureDate,
        start_time: futureTime,
        status: SLOT_STATUS.BLOCKED,
        update: jest.fn().mockImplementation(function (data) {
          this.status = data.status;
          return Promise.resolve(this);
        }),
      };

      jest.spyOn(DoctorProfile, 'findOne').mockResolvedValue({ id: 10, user_id: 201, status: DOCTOR_STATUS.APPROVED });
      jest.spyOn(AvailabilitySlot, 'findByPk').mockResolvedValue(fakeSlot);

      const res = await request(app)
        .patch('/api/doctors/slots/404/unblock')
        .set('Cookie', [`token=${approvedDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(SLOT_STATUS.AVAILABLE);
    });

    test('18. doctor cannot unblock a slot in the past (400 Bad Request)', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      const fakeSlot = {
        id: 405,
        doctor_profile_id: 10,
        slot_date: '2020-01-01',
        start_time: '10:00:00',
        status: SLOT_STATUS.BLOCKED,
      };

      jest.spyOn(DoctorProfile, 'findOne').mockResolvedValue({ id: 10, user_id: 201, status: DOCTOR_STATUS.APPROVED });
      jest.spyOn(AvailabilitySlot, 'findByPk').mockResolvedValue(fakeSlot);

      const res = await request(app)
        .patch('/api/doctors/slots/405/unblock')
        .set('Cookie', [`token=${approvedDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Cannot unblock a slot in the past/i);
    });

    test('19. doctor cannot delete slot that has historical appointment history (400 Bad Request)', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      const fakeSlot = {
        id: 406,
        doctor_profile_id: 10,
        status: SLOT_STATUS.AVAILABLE,
      };

      jest.spyOn(DoctorProfile, 'findOne').mockResolvedValue({ id: 10, user_id: 201, status: DOCTOR_STATUS.APPROVED });
      jest.spyOn(AvailabilitySlot, 'findByPk').mockResolvedValue(fakeSlot);
      // Historical appointments exist (e.g. cancelled/rescheduled)
      jest.spyOn(Appointment, 'count').mockResolvedValue(2);

      const res = await request(app)
        .delete('/api/doctors/slots/406')
        .set('Cookie', [`token=${approvedDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/associated appointment history/i);
    });

    test('20. doctor successfully deletes slot with zero appointment history (200 OK)', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      const fakeSlot = {
        id: 407,
        doctor_profile_id: 10,
        status: SLOT_STATUS.AVAILABLE,
        destroy: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(DoctorProfile, 'findOne').mockResolvedValue({ id: 10, user_id: 201, status: DOCTOR_STATUS.APPROVED });
      jest.spyOn(AvailabilitySlot, 'findByPk').mockResolvedValue(fakeSlot);
      jest.spyOn(Appointment, 'count').mockResolvedValue(0);

      const res = await request(app)
        .delete('/api/doctors/slots/407')
        .set('Cookie', [`token=${approvedDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(407);
      expect(fakeSlot.destroy).toHaveBeenCalled();
    });

    test('21. doctor A cannot block, unblock, or delete doctor B slot (403 Forbidden)', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      // Slot belongs to doctor profile 10
      const fakeSlot = {
        id: 408,
        doctor_profile_id: 10,
        status: SLOT_STATUS.AVAILABLE,
      };

      // Authenticated doctor is doctor profile 14 (otherDoctorToken)
      jest.spyOn(DoctorProfile, 'findOne').mockResolvedValue({ id: 14, user_id: 204, status: DOCTOR_STATUS.APPROVED });
      jest.spyOn(AvailabilitySlot, 'findByPk').mockResolvedValue(fakeSlot);

      const res = await request(app)
        .delete('/api/doctors/slots/408')
        .set('Cookie', [`token=${otherDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/You do not own this availability slot/i);
    });

    test('22. unauthenticated callers and incorrect roles are strictly rejected on reschedule and slot control endpoints', async () => {
      // Unauthenticated reschedule request
      const res1 = await request(app)
        .post('/api/appointments/901/reschedule')
        .set('Content-Type', 'application/json')
        .send({});
      expect(res1.status).toBe(401);

      // Doctor attempting patient reschedule endpoint
      const res2 = await request(app)
        .post('/api/appointments/901/reschedule')
        .set('Cookie', [`token=${approvedDoctorToken}`])
        .set('Content-Type', 'application/json')
        .send({});
      expect(res2.status).toBe(403);

      // Patient attempting doctor slot block endpoint
      const res3 = await request(app)
        .patch('/api/doctors/slots/401/block')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({});
      expect(res3.status).toBe(403);
    });

    test('23. concurrent duplicate reschedule requests cannot create two pending records (serialized under appointment lock)', async () => {
      let pendingRequestCount = 0;

      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return await callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      const fakeAppt = {
        id: 923,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 301,
        status: APPOINTMENT_STATUS.BOOKED,
        slot: { id: 301, slot_date: futureDate, start_time: futureTime, doctor_profile_id: 10 },
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeAppt);
      jest.spyOn(AvailabilitySlot, 'findOne').mockResolvedValue({
        id: 302,
        slot_date: futureDate2,
        start_time: futureTime2,
        status: SLOT_STATUS.AVAILABLE,
      });

      // Under lock, first request sees 0 pending and creates 1;
      // Second request sees 1 pending and is rejected with 409
      jest.spyOn(RescheduleRequest, 'findOne').mockImplementation(async () => {
        if (pendingRequestCount > 0) {
          return { id: 523, appointment_id: 923, status: RESCHEDULE_STATUS.PENDING };
        }
        return null;
      });

      jest.spyOn(RescheduleRequest, 'create').mockImplementation(async () => {
        pendingRequestCount++;
        return {
          id: 523,
          appointment_id: 923,
          requested_by: 301,
          suggested_slot_id: 302,
          status: RESCHEDULE_STATUS.PENDING,
        };
      });

      const [resA, resB] = await Promise.all([
        request(app)
          .post('/api/appointments/923/reschedule')
          .set('Cookie', [`token=${patientToken}`])
          .set('Content-Type', 'application/json')
          .send({ reason: 'Request A' }),
        request(app)
          .post('/api/appointments/923/reschedule')
          .set('Cookie', [`token=${patientToken}`])
          .set('Content-Type', 'application/json')
          .send({ reason: 'Request B' }),
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([201, 409]);
      expect(pendingRequestCount).toBe(1);
    });

    test('24. PostgreSQL unique constraint violation 23505 maps to HTTP 409 Conflict', async () => {
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      const fakeAppt = {
        id: 924,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 301,
        status: APPOINTMENT_STATUS.BOOKED,
        slot: { id: 301, slot_date: futureDate, start_time: futureTime, doctor_profile_id: 10 },
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeAppt);
      jest.spyOn(RescheduleRequest, 'findOne').mockResolvedValue(null);
      jest.spyOn(AvailabilitySlot, 'findOne').mockResolvedValue({
        id: 302,
        slot_date: futureDate2,
        start_time: futureTime2,
        status: SLOT_STATUS.AVAILABLE,
      });

      // Simulate PostgreSQL unique violation on race condition
      const uniqueError = new Error('duplicate key value violates unique constraint');
      uniqueError.name = 'SequelizeUniqueConstraintError';
      uniqueError.original = { code: '23505' };
      jest.spyOn(RescheduleRequest, 'create').mockRejectedValue(uniqueError);

      const res = await request(app)
        .post('/api/appointments/924/reschedule')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({ reason: 'Simultaneous insert test' });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/pending reschedule request already exists/i);
    });

    test('25. two simultaneous confirmations cannot create two new appointments', async () => {
      let appointmentCreationCount = 0;
      let apptStatus = APPOINTMENT_STATUS.BOOKED;
      let reqStatus = RESCHEDULE_STATUS.PENDING;

      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      const fakeAppt = {
        id: 925,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 301,
        get status() { return apptStatus; },
        set status(val) { apptStatus = val; },
        consultation_fee: 500,
        commission_amount: 50,
        total_fee: 550,
        commission_type: 'percentage',
        commission_value: 10,
        update: jest.fn().mockImplementation(async (data) => {
          if (data.status) apptStatus = data.status;
          return true;
        }),
      };

      const fakeRequest = {
        id: 525,
        appointment_id: 925,
        suggested_slot_id: 302,
        get status() { return reqStatus; },
        set status(val) { reqStatus = val; },
        update: jest.fn().mockImplementation(async (data) => {
          if (data.status) reqStatus = data.status;
          return true;
        }),
      };

      const fakeOldSlot = {
        id: 301,
        slot_date: futureDate,
        start_time: futureTime,
        status: SLOT_STATUS.BOOKED,
        update: jest.fn().mockResolvedValue(true),
      };

      const fakeNewSlot = {
        id: 302,
        slot_date: futureDate2,
        start_time: futureTime2,
        status: SLOT_STATUS.AVAILABLE,
        update: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeAppt);
      jest.spyOn(RescheduleRequest, 'findOne').mockResolvedValue(fakeRequest);
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue({ id: 10, user_id: 201 });
      jest.spyOn(AvailabilitySlot, 'findByPk').mockImplementation(async (id) => {
        return id === 301 ? fakeOldSlot : fakeNewSlot;
      });

      jest.spyOn(Appointment, 'create').mockImplementation(async () => {
        appointmentCreationCount++;
        return { id: 926 };
      });
      jest.spyOn(Notification, 'create').mockResolvedValue({ id: 1 });

      // Run two confirmation calls sequentially simulating transaction row-lock serialization
      const resA = await request(app)
        .put('/api/appointments/925/reschedule/confirm')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      const resB = await request(app)
        .put('/api/appointments/925/reschedule/confirm')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(409); // Second confirmation rejected because appt is now rescheduled!
      expect(appointmentCreationCount).toBe(1); // Only 1 appointment created!
    });

    test('26. transaction rollback occurs for unrelated unexpected database failures during confirmation', async () => {
      let rollbackOccurred = false;
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        try {
          return await callback({ LOCK: { UPDATE: 'UPDATE' } });
        } catch (err) {
          rollbackOccurred = true;
          throw err;
        }
      });

      const fakeAppt = {
        id: 926,
        patient_id: 301,
        doctor_profile_id: 10,
        slot_id: 301,
        status: APPOINTMENT_STATUS.BOOKED,
      };

      const fakeRequest = {
        id: 526,
        appointment_id: 926,
        suggested_slot_id: 302,
        status: RESCHEDULE_STATUS.PENDING,
      };

      jest.spyOn(Appointment, 'findByPk').mockResolvedValue(fakeAppt);
      jest.spyOn(RescheduleRequest, 'findOne').mockResolvedValue(fakeRequest);
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue({ id: 10, user_id: 201 });
      jest.spyOn(AvailabilitySlot, 'findByPk').mockRejectedValue(new Error('Fatal DB disk error'));

      const res = await request(app)
        .put('/api/appointments/926/reschedule/confirm')
        .set('Cookie', [`token=${patientToken}`])
        .set('Content-Type', 'application/json')
        .send({});

      expect(res.status).toBe(500);
      expect(rollbackOccurred).toBe(true);
    });
  });
});
