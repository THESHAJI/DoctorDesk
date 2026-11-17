'use strict';

/**
 * Milestone 8: Notification System Tests
 * Tests for notification retrieval, read flags, booking confirmation triggers,
 * scheduled reminders, cancellation invalidation, duplicate prevention, and worker claiming.
 */

const request = require('supertest');
const app = require('../src/app');
const {
  User,
  DoctorProfile,
  Appointment,
  AvailabilitySlot,
  Notification,
  AppSetting,
  RescheduleRequest,
  sequelize,
} = require('../src/models');
const { ROLES, NOTIFICATION_TYPES, APPOINTMENT_STATUS, SLOT_STATUS, DOCTOR_STATUS } = require('../src/config/constants');
const AuthService = require('../src/services/auth.service');
const NotificationService = require('../src/services/notification.service');
const AppointmentService = require('../src/services/appointment.service');
const generateToken = (user) => AuthService.generateToken(user);

// Mock Sequelize models for Jest
jest.mock('../src/models', () => {
  const actualModels = jest.requireActual('../src/models');
  return {
    ...actualModels,
    User: {
      ...actualModels.User,
      findByPk: jest.fn(),
      findOne: jest.fn(),
    },
    DoctorProfile: {
      ...actualModels.DoctorProfile,
      findByPk: jest.fn(),
      findOne: jest.fn(),
    },
    Appointment: {
      ...actualModels.Appointment,
      findByPk: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      findAndCountAll: jest.fn(),
      count: jest.fn(),
    },
    AvailabilitySlot: {
      ...actualModels.AvailabilitySlot,
      findByPk: jest.fn(),
      findOne: jest.fn(),
      findAll: jest.fn(),
    },
    Notification: {
      ...actualModels.Notification,
      findByPk: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      destroy: jest.fn(),
      count: jest.fn(),
      findAll: jest.fn(),
      findAndCountAll: jest.fn(),
    },
    AppSetting: {
      ...actualModels.AppSetting,
      findAll: jest.fn(),
    },
    RescheduleRequest: {
      ...actualModels.RescheduleRequest,
      findOne: jest.fn(),
      create: jest.fn(),
    },
    sequelize: {
      ...actualModels.sequelize,
      transaction: jest.fn(),
    },
  };
});

describe('Milestone 8: Notification System', () => {
  const patientUser = { id: 30, role: ROLES.PATIENT, email: 'notif_pat@test.local' };
  const patientToken = generateToken(patientUser);
  const doctorUser = { id: 70, role: ROLES.DOCTOR, email: 'notif_doc@test.local' };
  const doctorToken = generateToken(doctorUser);

  beforeEach(() => {
    jest.clearAllMocks();

    User.findByPk.mockImplementation(async (id) => {
      if (id === 30) return { ...patientUser, is_active: true };
      if (id === 70) return { ...doctorUser, is_active: true };
      return null;
    });

    sequelize.transaction.mockImplementation(async (callback) => {
      const mockTx = {
        LOCK: { UPDATE: 'UPDATE' },
        commit: jest.fn(),
        rollback: jest.fn(),
      };
      return await callback(mockTx);
    });
  });

  describe('GET /api/notifications - List Notifications', () => {
    it('should return paginated list of user notifications', async () => {
      Notification.findAndCountAll.mockResolvedValue({
        count: 2,
        rows: [
          {
            id: 1,
            appointment_id: 10,
            type: NOTIFICATION_TYPES.BOOKING_CONFIRMATION,
            title: 'Booking Confirmed',
            message: 'Your appointment is booked',
            is_read: false,
            is_sent: true,
            sent_at: new Date(),
            created_at: new Date(),
          },
          {
            id: 2,
            appointment_id: 10,
            type: NOTIFICATION_TYPES.REMINDER_1DAY,
            title: 'Reminder',
            message: 'Your appointment is tomorrow',
            is_read: true,
            is_sent: true,
            sent_at: new Date(),
            created_at: new Date(),
          },
        ],
      });

      const res = await request(app)
        .get('/api/notifications?page=1&limit=10')
        .set('Cookie', `token=${patientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.notifications).toHaveLength(2);
      expect(res.body.data.pagination.total).toBe(2);
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(401);
    });
  });

  describe('Appointment booking notification ownership', () => {
    it('uses the authenticated patient ID when creating booking notifications and reminders', async () => {
      const slot = {
        id: 501,
        doctor_profile_id: 7,
        slot_date: '2099-01-02',
        start_time: '10:00:00',
        end_time: '10:30:00',
        status: SLOT_STATUS.AVAILABLE,
        update: jest.fn().mockResolvedValue(true),
      };
      const doctorProfile = {
        id: 7,
        user_id: 70,
        status: 'approved',
        consultation_fee: '100.00',
        specialization: 'Cardiology',
        qualification: 'MD',
      };
      const appointment = {
        id: 900,
        doctor_profile_id: 7,
        slot_id: 501,
        status: APPOINTMENT_STATUS.BOOKED,
        consultation_fee: '100.00',
        commission_amount: '10.00',
        total_fee: '100.00',
        commission_type: 'percentage',
        commission_value: '10.00',
        booked_at: new Date(),
      };
      AvailabilitySlot.findByPk.mockResolvedValue(slot);
      AvailabilitySlot.findOne.mockResolvedValue(slot);
      DoctorProfile.findByPk.mockResolvedValue(doctorProfile);
      AppSetting.findAll.mockResolvedValue([]);
      Appointment.create.mockResolvedValue(appointment);
      const confirmation = jest.spyOn(NotificationService, 'createBookingConfirmation').mockResolvedValue();
      const reminders = jest.spyOn(NotificationService, 'scheduleRemindersForAppointment').mockResolvedValue();

      const result = await AppointmentService.bookAppointment(30, { slotId: 501 });

      expect(result.appointment.id).toBe(900);
      expect(confirmation).toHaveBeenCalledWith(900, slot, 30, doctorProfile, expect.any(Object));
      expect(reminders).toHaveBeenCalledWith(900, slot, 30, expect.any(Object));
      confirmation.mockRestore();
      reminders.mockRestore();
    });

    describe('Appointment management APIs', () => {
      it('lists only the authenticated patient appointments with a safe projection', async () => {
        Appointment.findAndCountAll.mockResolvedValue({
          count: 1,
          rows: [{
            toJSON: () => ({
              id: 101,
              status: APPOINTMENT_STATUS.BOOKED,
              consultation_fee: '100.00',
              slot: { id: 501, slot_date: '2099-01-02', start_time: '10:00:00', end_time: '10:30:00' },
              doctorProfile: { id: 7, specialization: 'Cardiology', user: { name: 'Doctor' } },
              patient_id: 999,
              password_hash: 'must not be returned',
            }),
          }],
        });

        const res = await request(app)
          .get('/api/appointments/my?page=2&limit=5')
          .set('Cookie', `token=${patientToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data.appointments[0]).not.toHaveProperty('patient_id');
        expect(res.body.data.appointments[0]).not.toHaveProperty('password_hash');
        expect(Appointment.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({
          where: { patient_id: patientUser.id },
          limit: 5,
          offset: 5,
        }));
      });

      it('completes an assigned approved doctor appointment after slot end and notifies the patient', async () => {
        const appointment = {
          id: 101,
          patient_id: 30,
          doctor_profile_id: 7,
          slot_id: 501,
          status: APPOINTMENT_STATUS.BOOKED,
          update: jest.fn(async (values) => Object.assign(appointment, values)),
        };
        const slot = {
          id: 501,
          slot_date: '2020-01-02',
          start_time: '10:00:00',
          end_time: '10:30:00',
          status: SLOT_STATUS.BOOKED,
        };
        Appointment.findByPk.mockResolvedValue(appointment);
        DoctorProfile.findByPk.mockResolvedValue({
          id: 7, user_id: 70, status: DOCTOR_STATUS.APPROVED,
        });
        AvailabilitySlot.findByPk.mockResolvedValue(slot);
        RescheduleRequest.findOne.mockResolvedValue(null);
        Notification.create.mockResolvedValue({ id: 999 });

        const res = await request(app)
          .patch('/api/appointments/101/complete')
          .set('Cookie', `token=${doctorToken}`)
          .send({});

        expect(res.status).toBe(200);
        expect(res.body.data.appointment.status).toBe(APPOINTMENT_STATUS.COMPLETED);
        expect(appointment.update).toHaveBeenCalledWith(
          expect.objectContaining({ status: APPOINTMENT_STATUS.COMPLETED }),
          expect.any(Object)
        );
        expect(Notification.create).toHaveBeenCalledWith(
          expect.objectContaining({
            user_id: 30,
            appointment_id: 101,
            type: NOTIFICATION_TYPES.COMPLETED,
          }),
          expect.any(Object)
        );
      });

      it('lets the assigned doctor suggest a slot without committing until the patient confirms', async () => {
        Appointment.findByPk.mockResolvedValue({
          id: 102,
          patient_id: 30,
          doctor_profile_id: 7,
          slot_id: 501,
          status: APPOINTMENT_STATUS.BOOKED,
        });
        DoctorProfile.findByPk.mockResolvedValue({
          id: 7, user_id: 70, status: DOCTOR_STATUS.APPROVED,
        });
        AvailabilitySlot.findByPk.mockResolvedValue({
          id: 501,
          doctor_profile_id: 7,
          slot_date: '2099-01-02',
          start_time: '10:00:00',
          status: SLOT_STATUS.BOOKED,
        });
        AvailabilitySlot.findAll.mockResolvedValue([{
          id: 502,
          slot_date: '2099-01-03',
          start_time: '11:00:00',
          end_time: '11:30:00',
        }]);
        RescheduleRequest.findOne.mockResolvedValue(null);
        RescheduleRequest.create.mockResolvedValue({ id: 300, status: 'pending' });

        const res = await request(app)
          .post('/api/appointments/102/doctor-reschedule')
          .set('Cookie', `token=${doctorToken}`)
          .send({ reason: 'Clinic schedule changed' });

        expect(res.status).toBe(201);
        expect(res.body.data.requiresPatientConfirmation).toBe(true);
        expect(RescheduleRequest.create).toHaveBeenCalledWith(
          expect.objectContaining({ requested_by: doctorUser.id, suggested_slot_id: 502 }),
          expect.any(Object)
        );
        expect(Notification.create).toHaveBeenCalledWith(
          expect.objectContaining({ user_id: 30, appointment_id: 102 }),
          expect.any(Object)
        );
      });
    });
  });

  describe('GET /api/notifications/unread-count - Unread Count', () => {
    it('should return unread notifications count', async () => {
      Notification.count.mockResolvedValue(5);

      const res = await request(app)
        .get('/api/notifications/unread-count')
        .set('Cookie', `token=${patientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.unreadCount).toBe(5);
    });
  });

  describe('PATCH /api/notifications/:id/read - Mark Single Read', () => {
    it('should mark an owned notification as read', async () => {
      const mockNotif = {
        id: 1,
        user_id: 30,
        is_read: false,
        update: jest.fn().mockResolvedValue(true),
      };
      Notification.findOne.mockResolvedValue(mockNotif);

      const res = await request(app)
        .patch('/api/notifications/1/read')
        .set('Cookie', `token=${patientToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(mockNotif.update).toHaveBeenCalledWith({ is_read: true });
    });

    it('should return 404 if notification does not exist or belongs to another user', async () => {
      Notification.findOne.mockResolvedValue(null);

      const res = await request(app)
        .patch('/api/notifications/999/read')
        .set('Cookie', `token=${patientToken}`)
        .send({});

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/notifications/read-all - Mark All Read', () => {
    it('should mark all unread notifications as read', async () => {
      Notification.update.mockResolvedValue([3]);

      const res = await request(app)
        .patch('/api/notifications/read-all')
        .set('Cookie', `token=${patientToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.markedCount).toBe(3);
    });
  });

  describe('NotificationService Business Rules & Worker Claiming', () => {
    it('should calculate reminders for future slot in Asia/Kolkata', async () => {
      const futureDate = new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0];
      const slot = {
        slot_date: futureDate,
        start_time: '14:00:00',
      };

      Notification.create.mockResolvedValue({ id: 101 });

      await NotificationService.scheduleRemindersForAppointment(50, slot, 30, {});

      // Should attempt to schedule future reminders
      expect(Notification.create).toHaveBeenCalled();
    });

    it('should drop reminders during worker run if appointment is cancelled or rescheduled', async () => {
      const mockReminder = {
        id: 10,
        appointment_id: 77,
        is_sent: false,
        destroy: jest.fn().mockResolvedValue(true),
        update: jest.fn(),
      };

      Notification.findAll.mockResolvedValue([mockReminder]);
      // Appointment is cancelled
      Appointment.findByPk.mockResolvedValue({ id: 77, status: APPOINTMENT_STATUS.CANCELLED });

      const result = await NotificationService.processDueReminders(10);

      expect(mockReminder.destroy).toHaveBeenCalled();
      expect(mockReminder.update).not.toHaveBeenCalled();
      expect(result.dropped).toBe(1);
      expect(result.sent).toBe(0);
    });

    it('should safely dispatch and mark is_sent = true for active booked appointment reminders', async () => {
      const mockReminder = {
        id: 11,
        appointment_id: 88,
        is_sent: false,
        destroy: jest.fn(),
        update: jest.fn().mockResolvedValue(true),
      };

      Notification.findAll.mockResolvedValue([mockReminder]);
      // Appointment is still booked
      Appointment.findByPk.mockResolvedValue({ id: 88, status: APPOINTMENT_STATUS.BOOKED });

      const result = await NotificationService.processDueReminders(10);

      expect(mockReminder.update).toHaveBeenCalledWith(
        expect.objectContaining({ is_sent: true }),
        expect.anything()
      );
      expect(result.sent).toBe(1);
    });

    it('should invalidate pending reminders upon appointment cancellation', async () => {
      Notification.destroy.mockResolvedValue(2);

      await NotificationService.invalidatePendingReminders(99, {});

      expect(Notification.destroy).toHaveBeenCalledWith({
        where: {
          appointment_id: 99,
          is_sent: false,
        },
        transaction: {},
      });
    });
  });
});
