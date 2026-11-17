'use strict';

/**
 * Milestone 7: Prescription Management Tests
 * Unit & Integration tests for prescription creation, retrieval, authorization, validation, and atomicity.
 */

const request = require('supertest');
const app = require('../src/app');
const {
  User,
  DoctorProfile,
  Appointment,
  Prescription,
  PrescriptionItem,
  sequelize,
} = require('../src/models');
const { ROLES, DOCTOR_STATUS, APPOINTMENT_STATUS } = require('../src/config/constants');
const AuthService = require('../src/services/auth.service');
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
      count: jest.fn(),
    },
    Prescription: {
      ...actualModels.Prescription,
      findByPk: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      findAndCountAll: jest.fn(),
    },
    PrescriptionItem: {
      ...actualModels.PrescriptionItem,
      bulkCreate: jest.fn(),
    },
    sequelize: {
      ...actualModels.sequelize,
      transaction: jest.fn(),
    },
  };
});

describe('Milestone 7: Prescription Management', () => {
  const doctorUser = { id: 10, role: ROLES.DOCTOR, email: 'doc@test.local' };
  const doctorToken = generateToken(doctorUser);

  const otherDoctorUser = { id: 11, role: ROLES.DOCTOR, email: 'otherdoc@test.local' };
  const otherDoctorToken = generateToken(otherDoctorUser);

  const patientUser = { id: 20, role: ROLES.PATIENT, email: 'patient@test.local' };
  const patientToken = generateToken(patientUser);

  const otherPatientUser = { id: 21, role: ROLES.PATIENT, email: 'otherpatient@test.local' };
  const otherPatientToken = generateToken(otherPatientUser);

  const approvedDoctorProfile = {
    id: 1,
    user_id: 10,
    status: DOCTOR_STATUS.APPROVED,
    specialization: 'Cardiology',
    qualification: 'MBBS, MD',
  };

  const sampleItems = [
    {
      medicine_name: 'Paracetamol',
      dosage: '500mg',
      frequency: '1-0-1',
      duration: '5 days',
      instructions: 'After food',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    User.findByPk.mockImplementation(async (id) => {
      if (id === 10) return { ...doctorUser, is_active: true };
      if (id === 11) return { ...otherDoctorUser, is_active: true };
      if (id === 20) return { ...patientUser, is_active: true };
      if (id === 21) return { ...otherPatientUser, is_active: true };
      return null;
    });

    // Default transaction mock
    sequelize.transaction.mockImplementation(async (callback) => {
      const mockTx = {
        LOCK: { UPDATE: 'UPDATE' },
        commit: jest.fn(),
        rollback: jest.fn(),
      };
      return await callback(mockTx);
    });
  });

  describe('POST /api/prescriptions - Create Prescription', () => {
    it('should reject request from non-doctor user', async () => {
      const res = await request(app)
        .post('/api/prescriptions')
        .set('Cookie', `token=${patientToken}`)
        .send({
          appointmentId: 100,
          items: sampleItems,
        });

      expect(res.status).toBe(403);
    });

    it('should fail validation if items array is missing or empty', async () => {
      const res = await request(app)
        .post('/api/prescriptions')
        .set('Cookie', `token=${doctorToken}`)
        .send({
          appointmentId: 100,
          items: [],
        });

      expect(res.status).toBe(422);
      expect(res.body.errors[0].field).toBe('items');
    });

    it('should fail validation if an item lacks mandatory fields', async () => {
      const res = await request(app)
        .post('/api/prescriptions')
        .set('Cookie', `token=${doctorToken}`)
        .send({
          appointmentId: 100,
          items: [{ medicine_name: 'Amoxicillin' }], // missing dosage, frequency, duration
        });

      expect(res.status).toBe(422);
    });

    it('should reject if doctor profile is not approved', async () => {
      DoctorProfile.findOne.mockResolvedValue({
        id: 1,
        user_id: 10,
        status: DOCTOR_STATUS.PENDING,
      });

      const res = await request(app)
        .post('/api/prescriptions')
        .set('Cookie', `token=${doctorToken}`)
        .send({
          appointmentId: 100,
          items: sampleItems,
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('approved');
    });

    it('should reject if appointment is not found', async () => {
      DoctorProfile.findOne.mockResolvedValue(approvedDoctorProfile);
      Appointment.findByPk.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/prescriptions')
        .set('Cookie', `token=${doctorToken}`)
        .send({
          appointmentId: 999,
          items: sampleItems,
        });

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Appointment not found');
    });

    it('should reject if appointment does not belong to this doctor', async () => {
      DoctorProfile.findOne.mockResolvedValue(approvedDoctorProfile);
      Appointment.findByPk.mockResolvedValue({
        id: 100,
        doctor_profile_id: 99, // belongs to someone else
        status: APPOINTMENT_STATUS.COMPLETED,
        patient_id: 20,
      });

      const res = await request(app)
        .post('/api/prescriptions')
        .set('Cookie', `token=${doctorToken}`)
        .send({
          appointmentId: 100,
          items: sampleItems,
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Forbidden');
    });

    it('should reject if appointment status is not COMPLETED (e.g. booked, cancelled)', async () => {
      DoctorProfile.findOne.mockResolvedValue(approvedDoctorProfile);
      Appointment.findByPk.mockResolvedValue({
        id: 100,
        doctor_profile_id: 1,
        status: APPOINTMENT_STATUS.BOOKED,
        patient_id: 20,
      });

      const res = await request(app)
        .post('/api/prescriptions')
        .set('Cookie', `token=${doctorToken}`)
        .send({
          appointmentId: 100,
          items: sampleItems,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('completed appointments');
    });

    it('should reject with 409 if prescription already exists for appointment', async () => {
      DoctorProfile.findOne.mockResolvedValue(approvedDoctorProfile);
      Appointment.findByPk.mockResolvedValue({
        id: 100,
        doctor_profile_id: 1,
        status: APPOINTMENT_STATUS.COMPLETED,
        patient_id: 20,
      });
      Prescription.findOne.mockResolvedValue({ id: 50, appointment_id: 100 });

      const res = await request(app)
        .post('/api/prescriptions')
        .set('Cookie', `token=${doctorToken}`)
        .send({
          appointmentId: 100,
          items: sampleItems,
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('already been created');
    });

    it('should successfully create prescription and items atomically in transaction', async () => {
      DoctorProfile.findOne.mockResolvedValue(approvedDoctorProfile);
      Appointment.findByPk.mockResolvedValue({
        id: 100,
        doctor_profile_id: 1,
        status: APPOINTMENT_STATUS.COMPLETED,
        patient_id: 20,
      });
      Prescription.findOne.mockResolvedValue(null);

      Prescription.create.mockResolvedValue({
        id: 55,
        appointment_id: 100,
        doctor_profile_id: 1,
        patient_id: 20,
        diagnosis: 'Hypertension',
        notes: 'Follow up in 2 weeks',
        createdAt: new Date('2026-01-02T03:04:05.000Z'),
      });

      PrescriptionItem.bulkCreate.mockResolvedValue([
        {
          id: 201,
          medicine_name: 'Amlodipine',
          dosage: '5mg',
          frequency: '1-0-0',
          duration: '30 days',
          instructions: 'Morning after food',
        },
      ]);

      const res = await request(app)
        .post('/api/prescriptions')
        .set('Cookie', `token=${doctorToken}`)
        .send({
          appointmentId: 100,
          diagnosis: 'Hypertension',
          notes: 'Follow up in 2 weeks',
          items: [
            {
              medicine_name: 'Amlodipine',
              dosage: '5mg',
              frequency: '1-0-0',
              duration: '30 days',
              instructions: 'Morning after food',
            },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(55);
      expect(res.body.data.items).toHaveLength(1);
      expect(Prescription.create).toHaveBeenCalled();
      expect(PrescriptionItem.bulkCreate).toHaveBeenCalled();
    });
  });

  describe('GET /api/prescriptions/:id - Single Prescription Details', () => {
    const mockPrescription = {
      id: 55,
      appointment_id: 100,
      patient_id: 20,
      diagnosis: 'Fever',
      notes: 'Rest for 3 days',
      createdAt: new Date('2026-01-02T03:04:05.000Z'),
      items: [
        {
          id: 1,
          medicine_name: 'Paracetamol',
          dosage: '650mg',
          frequency: '1-1-1',
          duration: '3 days',
          instructions: 'SOS',
        },
      ],
      patient: { id: 20, name: 'John Doe', email: 'patient@test.local', phone: '9876543210' },
      doctorProfile: {
        id: 1,
        user_id: 10,
        specialization: 'General',
        qualification: 'MBBS',
        user: { id: 10, name: 'Dr. Smith' },
      },
    };

    it('should allow patient owner to view prescription', async () => {
      Prescription.findByPk.mockResolvedValue(mockPrescription);

      const res = await request(app)
        .get('/api/prescriptions/55')
        .set('Cookie', `token=${patientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(55);
      expect(res.body.data.patient.id).toBe(20);
      expect(res.body.data.created_at).toBe('2026-01-02T03:04:05.000Z');
    });

    it('should allow prescribing doctor to view prescription', async () => {
      Prescription.findByPk.mockResolvedValue(mockPrescription);

      const res = await request(app)
        .get('/api/prescriptions/55')
        .set('Cookie', `token=${doctorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(55);
      expect(res.body.data.doctor.id).toBe(1);
    });

    it('should reject other patient with 403 Forbidden', async () => {
      Prescription.findByPk.mockResolvedValue(mockPrescription);

      const res = await request(app)
        .get('/api/prescriptions/55')
        .set('Cookie', `token=${otherPatientToken}`);

      expect(res.status).toBe(403);
    });

    it('should reject other doctor with 403 Forbidden', async () => {
      Prescription.findByPk.mockResolvedValue(mockPrescription);

      const res = await request(app)
        .get('/api/prescriptions/55')
        .set('Cookie', `token=${otherDoctorToken}`);

      expect(res.status).toBe(403);
    });

    it('should return 404 if prescription not found', async () => {
      Prescription.findByPk.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/prescriptions/999')
        .set('Cookie', `token=${patientToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/prescriptions/my - Patient List', () => {
    it('should list prescriptions belonging to patient with pagination', async () => {
      Prescription.findAndCountAll.mockResolvedValue({
        count: 1,
        rows: [
          {
            id: 55,
            appointment_id: 100,
            diagnosis: 'Checkup',
            items: [],
            doctorProfile: { id: 1, specialization: 'Cardiology', user: { name: 'Dr. Smith' } },
            createdAt: new Date('2026-01-02T03:04:05.000Z'),
          },
        ],
      });

      const res = await request(app)
        .get('/api/prescriptions/my?page=1&limit=10')
        .set('Cookie', `token=${patientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.prescriptions).toHaveLength(1);
      expect(res.body.data.pagination.total).toBe(1);
      expect(res.body.data.prescriptions[0].created_at).toBe('2026-01-02T03:04:05.000Z');
    });

    it('should reject non-patient user', async () => {
      const res = await request(app)
        .get('/api/prescriptions/my')
        .set('Cookie', `token=${doctorToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/prescriptions/doctor - Doctor List', () => {
    it('should list prescriptions created by doctor with pagination', async () => {
      DoctorProfile.findOne.mockResolvedValue(approvedDoctorProfile);
      Prescription.findAndCountAll.mockResolvedValue({
        count: 1,
        rows: [
          {
            id: 55,
            appointment_id: 100,
            diagnosis: 'Checkup',
            items: [],
            patient: { id: 20, name: 'John Doe', email: 'john@test.local' },
            createdAt: new Date('2026-01-02T03:04:05.000Z'),
          },
        ],
      });

      const res = await request(app)
        .get('/api/prescriptions/doctor?page=1&limit=10')
        .set('Cookie', `token=${doctorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.prescriptions).toHaveLength(1);
      expect(res.body.data.pagination.total).toBe(1);
      expect(res.body.data.prescriptions[0].created_at).toBe('2026-01-02T03:04:05.000Z');
    });

    it('should reject non-doctor user', async () => {
      const res = await request(app)
        .get('/api/prescriptions/doctor')
        .set('Cookie', `token=${patientToken}`);

      expect(res.status).toBe(403);
    });
  });
});
