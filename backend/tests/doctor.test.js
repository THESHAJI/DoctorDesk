const request = require('supertest');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const app = require('../src/app');
const { DoctorProfile, DoctorCertificate, User, sequelize } = require('../src/models');
const { ROLES, DOCTOR_STATUS } = require('../src/config/constants');
const { CERTIFICATE_UPLOAD_DIR } = require('../src/config/upload.config');

describe('Milestone 5: Doctor Profile Management, Certificates & Admin Approval', () => {
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalJwtExpiresIn = process.env.JWT_EXPIRES_IN;

  // Reusable auth tokens
  let doctorToken;
  let otherDoctorToken;
  let adminToken;
  let patientToken;

  // Temp files tracking for cleanup
  const createdTestFiles = [];

  const createDummyFile = (filename, bufferContent) => {
    const filePath = path.join(__dirname, filename);
    fs.writeFileSync(filePath, bufferContent);
    createdTestFiles.push(filePath);
    return filePath;
  };

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'milestone_5_test_secret_key_12345';
    process.env.JWT_EXPIRES_IN = '1h';

    doctorToken = jwt.sign(
      { id: 201, email: 'dr.smith@example.com', role: ROLES.DOCTOR },
      process.env.JWT_SECRET
    );

    otherDoctorToken = jwt.sign(
      { id: 202, email: 'dr.jones@example.com', role: ROLES.DOCTOR },
      process.env.JWT_SECRET
    );

    adminToken = jwt.sign(
      { id: 1, email: 'admin@doctordesk.com', role: ROLES.ADMIN },
      process.env.JWT_SECRET
    );

    patientToken = jwt.sign(
      { id: 301, email: 'patient@example.com', role: ROLES.PATIENT },
      process.env.JWT_SECRET
    );
  });

  afterAll(async () => {
    process.env.JWT_SECRET = originalJwtSecret;
    process.env.JWT_EXPIRES_IN = originalJwtExpiresIn;

    // Clean up temporary local test fixtures
    createdTestFiles.forEach((f) => {
      if (fs.existsSync(f)) {
        try {
          fs.unlinkSync(f);
        } catch (e) {}
      }
    });

    await sequelize.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // 1. DOCTOR SELF-SERVICE PROFILE TESTS
  // =========================================================================
  describe('1. Doctor Self-Service Profile Management', () => {
    test('GET /api/doctors/profile/me - doctor can retrieve own profile with certificates', async () => {
      const fakeProfile = DoctorProfile.build({
        id: 10,
        user_id: 201,
        specialization: 'Cardiology',
        qualification: 'MBBS, MD',
        consultation_fee: 500.0,
        bio: 'Heart specialist',
        status: DOCTOR_STATUS.PENDING,
      });
      fakeProfile.dataValues.user = { id: 201, name: 'Dr. Smith', email: 'dr.smith@example.com' };
      fakeProfile.dataValues.certificates = [];

      jest.spyOn(DoctorProfile, 'findOne').mockResolvedValue(fakeProfile);

      const res = await request(app)
        .get('/api/doctors/profile/me')
        .set('Cookie', [`token=${doctorToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.profile.specialization).toBe('Cardiology');
      expect(res.body.data.profile.user.email).toBe('dr.smith@example.com');
    });

    test('PUT /api/doctors/profile/me - doctor can update bio and consultation fee', async () => {
      const fakeProfile = DoctorProfile.build({
        id: 10,
        user_id: 201,
        specialization: 'Cardiology',
        qualification: 'MBBS, MD',
        consultation_fee: 500.0,
        bio: 'Old bio',
        status: DOCTOR_STATUS.APPROVED,
      });
      jest.spyOn(fakeProfile, 'update').mockResolvedValue(fakeProfile);

      // Return refreshed profile on subsequent getMyProfile call
      jest.spyOn(DoctorProfile, 'findOne')
        .mockResolvedValueOnce(fakeProfile) // for find in update
        .mockResolvedValueOnce({
          ...fakeProfile,
          toJSON: () => ({
            id: 10,
            user_id: 201,
            specialization: 'Cardiology',
            consultation_fee: 650.0,
            bio: 'Updated heart specialist bio',
          }),
        });

      const res = await request(app)
        .put('/api/doctors/profile/me')
        .set('Cookie', [`token=${doctorToken}`])
        .set('Content-Type', 'application/json')
        .send({
          consultationFee: 650,
          bio: 'Updated heart specialist bio',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(fakeProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          consultation_fee: 650,
          bio: 'Updated heart specialist bio',
        })
      );
    });

    test('PUT /api/doctors/profile/me - rejects negative consultation fee with 422', async () => {
      const res = await request(app)
        .put('/api/doctors/profile/me')
        .set('Cookie', [`token=${doctorToken}`])
        .set('Content-Type', 'application/json')
        .send({
          consultationFee: -100,
        });

      expect(res.status).toBe(422);
      expect(res.body.errors.some((e) => e.field === 'consultationFee')).toBe(true);
    });

    test('GET /api/doctors/profile/me - patient receives 403 Forbidden', async () => {
      const res = await request(app)
        .get('/api/doctors/profile/me')
        .set('Cookie', [`token=${patientToken}`]);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Required role: doctor/i);
    });
  });

  // =========================================================================
  // 2. FILE VALIDATION & CERTIFICATE UPLOAD TESTS
  // =========================================================================
  describe('2. Certificate Upload & 4-Layer File Validation', () => {
    test('POST /api/doctors/certificates - successfully uploads valid PDF document', async () => {
      // Valid PDF magic bytes: %PDF-1.4
      const validPdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
      const testFile = createDummyFile('valid_cert.pdf', validPdfBuffer);

      jest.spyOn(DoctorProfile, 'findOne').mockResolvedValue({ id: 10, user_id: 201 });

      let createdCertPath = null;
      jest.spyOn(DoctorCertificate, 'create').mockImplementation((data) => {
        createdCertPath = data.file_path;
        return Promise.resolve(
          DoctorCertificate.build({
            id: 1,
            doctor_profile_id: 10,
            file_name: data.file_name,
            original_name: data.original_name,
            file_path: data.file_path,
            mime_type: data.mime_type,
            file_size: data.file_size,
          })
        );
      });

      const res = await request(app)
        .post('/api/doctors/certificates')
        .set('Cookie', [`token=${doctorToken}`])
        .set('Origin', 'http://localhost:5173')
        .attach('certificate', testFile);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.certificate.original_name).toBe('valid_cert.pdf');
      expect(res.body.data.certificate.mime_type).toBe('application/pdf');
      // Ensure physical file path is NEVER exposed in the API response
      expect(res.body.data.certificate.file_path).toBeUndefined();

      // Clean up uploaded file from test storage
      if (createdCertPath && fs.existsSync(createdCertPath)) {
        fs.unlinkSync(createdCertPath);
      }
    });

    test('POST /api/doctors/certificates - successfully uploads valid JPEG image', async () => {
      // Valid JPEG magic bytes: FF D8 FF E0
      const validJpgBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
      const testFile = createDummyFile('valid_cert.jpg', validJpgBuffer);

      jest.spyOn(DoctorProfile, 'findOne').mockResolvedValue({ id: 10, user_id: 201 });

      let createdCertPath = null;
      jest.spyOn(DoctorCertificate, 'create').mockImplementation((data) => {
        createdCertPath = data.file_path;
        return Promise.resolve(
          DoctorCertificate.build({
            id: 2,
            doctor_profile_id: 10,
            file_name: data.file_name,
            original_name: data.original_name,
            file_path: data.file_path,
            mime_type: data.mime_type,
            file_size: data.file_size,
          })
        );
      });

      const res = await request(app)
        .post('/api/doctors/certificates')
        .set('Cookie', [`token=${doctorToken}`])
        .set('Origin', 'http://localhost:5173')
        .attach('certificate', testFile);

      expect(res.status).toBe(201);
      expect(res.body.data.certificate.mime_type).toBe('image/jpeg');

      if (createdCertPath && fs.existsSync(createdCertPath)) {
        fs.unlinkSync(createdCertPath);
      }
    });

    test('POST /api/doctors/certificates - rejects upload when Origin header is missing (403)', async () => {
      const res = await request(app)
        .post('/api/doctors/certificates')
        .set('Cookie', [`token=${doctorToken}`])
        .set('Content-Type', 'multipart/form-data; boundary=----WebKitFormBoundaryX')
        .send('------WebKitFormBoundaryX\r\nContent-Disposition: form-data; name="certificate"\r\n\r\nfake\r\n------WebKitFormBoundaryX--');

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Forbidden.*Origin/i);
    });

    test('POST /api/doctors/certificates - rejects upload from untrusted origin (403)', async () => {
      const res = await request(app)
        .post('/api/doctors/certificates')
        .set('Cookie', [`token=${doctorToken}`])
        .set('Origin', 'https://malicious-site.com')
        .set('Content-Type', 'multipart/form-data; boundary=----WebKitFormBoundaryX')
        .send('------WebKitFormBoundaryX\r\nContent-Disposition: form-data; name="certificate"\r\n\r\nfake\r\n------WebKitFormBoundaryX--');

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Forbidden.*Origin/i);
    });

    test('POST /api/doctors/certificates - rejects spoofed file (exe renamed to .pdf) and deletes from disk', async () => {
      // Fake PDF: starts with Windows executable MZ magic bytes
      const spoofedBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
      const testFile = createDummyFile('fake_malware.pdf', spoofedBuffer);

      const beforeFiles = fs.readdirSync(CERTIFICATE_UPLOAD_DIR);

      const res = await request(app)
        .post('/api/doctors/certificates')
        .set('Cookie', [`token=${doctorToken}`])
        .set('Origin', 'http://localhost:5173')
        .attach('certificate', testFile);

      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/File content does not match allowed format/i);

      // Verify that NO new file was left behind in CERTIFICATE_UPLOAD_DIR
      const afterFiles = fs.readdirSync(CERTIFICATE_UPLOAD_DIR);
      expect(afterFiles.length).toBe(beforeFiles.length);
    });

    test('POST /api/doctors/certificates - rejects invalid file extension with 422', async () => {
      const dummyFile = createDummyFile('script.exe', Buffer.from('malicious script'));

      const res = await request(app)
        .post('/api/doctors/certificates')
        .set('Cookie', [`token=${doctorToken}`])
        .set('Origin', 'http://localhost:5173')
        .attach('certificate', dummyFile);

      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/Invalid file extension/i);
    });

    test('POST /api/doctors/certificates - cleans up physical file when database insertion fails', async () => {
      const validPdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
      const testFile = createDummyFile('db_fail_test.pdf', validPdfBuffer);

      jest.spyOn(DoctorProfile, 'findOne').mockResolvedValue({ id: 10, user_id: 201 });
      jest.spyOn(DoctorCertificate, 'create').mockRejectedValue(new Error('PostgreSQL connection timeout'));

      const beforeFiles = fs.readdirSync(CERTIFICATE_UPLOAD_DIR);

      const res = await request(app)
        .post('/api/doctors/certificates')
        .set('Cookie', [`token=${doctorToken}`])
        .set('Origin', 'http://localhost:5173')
        .attach('certificate', testFile);

      expect(res.status).toBe(500);
      expect(res.body.message).toMatch(/Failed to save certificate record/i);

      // Verify physical disk file was cleaned up by catch block
      const afterFiles = fs.readdirSync(CERTIFICATE_UPLOAD_DIR);
      expect(afterFiles.length).toBe(beforeFiles.length);
    });
  });

  // =========================================================================
  // 3. CERTIFICATE ACCESS CONTROL & PATH TRAVERSAL DEFENSE
  // =========================================================================
  describe('3. Certificate Access Control & Path Traversal Prevention', () => {
    test('GET /api/doctors/certificates/:id - doctor owner can download certificate with nosniff header', async () => {
      // Create real temp file inside CERTIFICATE_UPLOAD_DIR to test actual streaming
      const realCertPath = path.join(CERTIFICATE_UPLOAD_DIR, 'test_owner_cert.pdf');
      fs.writeFileSync(realCertPath, Buffer.from('%PDF-1.4 test content'));

      jest.spyOn(DoctorCertificate, 'findByPk').mockResolvedValue({
        id: 5,
        original_name: 'medical_license.pdf',
        file_path: realCertPath,
        mime_type: 'application/pdf',
        doctorProfile: { id: 10, user_id: 201 }, // matches doctorToken user_id 201
      });

      const res = await request(app)
        .get('/api/doctors/certificates/5')
        .set('Cookie', [`token=${doctorToken}`]);

      expect(res.status).toBe(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-disposition']).toMatch(/attachment.*medical_license.pdf/);

      if (fs.existsSync(realCertPath)) fs.unlinkSync(realCertPath);
    });

    test('GET /api/doctors/certificates/:id - admin can download any doctor certificate', async () => {
      const realCertPath = path.join(CERTIFICATE_UPLOAD_DIR, 'test_admin_cert.pdf');
      fs.writeFileSync(realCertPath, Buffer.from('%PDF-1.4 admin test'));

      jest.spyOn(DoctorCertificate, 'findByPk').mockResolvedValue({
        id: 6,
        original_name: 'degree.pdf',
        file_path: realCertPath,
        mime_type: 'application/pdf',
        doctorProfile: { id: 10, user_id: 201 }, // Doctor 201's cert
      });

      const res = await request(app)
        .get('/api/doctors/certificates/6')
        .set('Cookie', [`token=${adminToken}`]); // Admin accessing

      expect(res.status).toBe(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');

      if (fs.existsSync(realCertPath)) fs.unlinkSync(realCertPath);
    });

    test('GET /api/doctors/certificates/:id - cross-doctor access is rejected with 403 Forbidden', async () => {
      jest.spyOn(DoctorCertificate, 'findByPk').mockResolvedValue({
        id: 5,
        original_name: 'private_cert.pdf',
        file_path: path.join(CERTIFICATE_UPLOAD_DIR, 'dummy.pdf'),
        doctorProfile: { id: 10, user_id: 201 }, // Owned by doctor 201
      });

      // Doctor 202 attempts to download Doctor 201's certificate
      const res = await request(app)
        .get('/api/doctors/certificates/5')
        .set('Cookie', [`token=${otherDoctorToken}`]);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Forbidden/i);
    });

    test('GET /api/doctors/certificates/:id - path traversal attempt escaping directory is rejected with 403', async () => {
      // Simulate malicious certificate record pointing outside CERTIFICATE_UPLOAD_DIR
      jest.spyOn(DoctorCertificate, 'findByPk').mockResolvedValue({
        id: 7,
        original_name: 'passwd.pdf',
        file_path: path.resolve(CERTIFICATE_UPLOAD_DIR, '../../../../windows/win.ini'),
        doctorProfile: { id: 10, user_id: 201 },
      });

      const res = await request(app)
        .get('/api/doctors/certificates/7')
        .set('Cookie', [`token=${doctorToken}`]);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Access denied.*traversal/i);
    });

    test('DELETE /api/doctors/certificates/:id - owner doctor deletes certificate and physical file', async () => {
      const realCertPath = path.join(CERTIFICATE_UPLOAD_DIR, 'to_delete.pdf');
      fs.writeFileSync(realCertPath, Buffer.from('%PDF-1.4 delete test'));

      const mockDestroy = jest.fn().mockResolvedValue(true);
      jest.spyOn(DoctorCertificate, 'findByPk').mockResolvedValue({
        id: 8,
        file_path: realCertPath,
        doctorProfile: { id: 10, user_id: 201 },
        destroy: mockDestroy,
      });

      const res = await request(app)
        .delete('/api/doctors/certificates/8')
        .set('Cookie', [`token=${doctorToken}`])
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(200);
      expect(mockDestroy).toHaveBeenCalled();
      expect(fs.existsSync(realCertPath)).toBe(false); // Verified deleted from disk
    });
  });

  // =========================================================================
  // 4. ADMIN APPROVAL LIFECYCLE & STATE MACHINE TESTS
  // =========================================================================
  describe('4. Admin Approval Lifecycle & State Transitions', () => {
    test('PATCH /api/admin/doctors/:id/approve - successfully approves pending doctor with row locking', async () => {
      const fakeDoctor = DoctorProfile.build({
        id: 15,
        user_id: 205,
        status: DOCTOR_STATUS.PENDING,
      });
      jest.spyOn(fakeDoctor, 'update').mockResolvedValue(fakeDoctor);

      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue(fakeDoctor);

      const res = await request(app)
        .patch('/api/admin/doctors/15/approve')
        .set('Cookie', [`token=${adminToken}`])
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/approved successfully/i);
      expect(fakeDoctor.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: DOCTOR_STATUS.APPROVED,
          approved_by: 1,
          reviewed_by: 1,
        }),
        expect.any(Object)
      );
    });

    test('PATCH /api/admin/doctors/:id/approve - idempotent approval returns friendly message', async () => {
      const fakeDoctor = DoctorProfile.build({
        id: 15,
        user_id: 205,
        status: DOCTOR_STATUS.APPROVED, // Already approved
      });

      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue(fakeDoctor);

      const res = await request(app)
        .patch('/api/admin/doctors/15/approve')
        .set('Cookie', [`token=${adminToken}`])
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Doctor is already approved');
    });

    test('PATCH /api/admin/doctors/:id/reject - rejects pending doctor and logs rejection reason', async () => {
      const fakeDoctor = DoctorProfile.build({
        id: 16,
        user_id: 206,
        status: DOCTOR_STATUS.PENDING,
      });
      jest.spyOn(fakeDoctor, 'update').mockResolvedValue(fakeDoctor);

      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue(fakeDoctor);

      const res = await request(app)
        .patch('/api/admin/doctors/16/reject')
        .set('Cookie', [`token=${adminToken}`])
        .set('Content-Type', 'application/json')
        .send({
          reason: 'Medical certificate has expired',
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/rejected successfully/i);
      expect(fakeDoctor.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: DOCTOR_STATUS.REJECTED,
          rejection_reason: 'Medical certificate has expired',
          reviewed_by: 1,
        }),
        expect.any(Object)
      );
    });

    test('PATCH /api/admin/doctors/:id/reject - requires reason with minimum length', async () => {
      const res = await request(app)
        .patch('/api/admin/doctors/16/reject')
        .set('Cookie', [`token=${adminToken}`])
        .set('Content-Type', 'application/json')
        .send({
          reason: 'No', // Too short (min 5 characters)
        });

      expect(res.status).toBe(422);
      expect(res.body.errors.some((e) => e.field === 'reason')).toBe(true);
    });

    test('PATCH /api/admin/doctors/:id/reject - cannot reject already approved doctor (must suspend)', async () => {
      const fakeDoctor = DoctorProfile.build({
        id: 17,
        user_id: 207,
        status: DOCTOR_STATUS.APPROVED,
      });

      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue(fakeDoctor);

      const res = await request(app)
        .patch('/api/admin/doctors/17/reject')
        .set('Cookie', [`token=${adminToken}`])
        .set('Content-Type', 'application/json')
        .send({
          reason: 'Invalid credentials detected after approval',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Cannot reject an already approved doctor.*Use the suspend action/i);
    });

    test('PATCH /api/admin/doctors/:id/suspend - suspends approved doctor and logs suspension reason', async () => {
      const fakeDoctor = DoctorProfile.build({
        id: 18,
        user_id: 208,
        status: DOCTOR_STATUS.APPROVED,
      });
      jest.spyOn(fakeDoctor, 'update').mockResolvedValue(fakeDoctor);

      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue(fakeDoctor);

      const res = await request(app)
        .patch('/api/admin/doctors/18/suspend')
        .set('Cookie', [`token=${adminToken}`])
        .set('Content-Type', 'application/json')
        .send({
          reason: 'License pending state medical board renewal inquiry',
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/suspended successfully/i);
      expect(fakeDoctor.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: DOCTOR_STATUS.SUSPENDED,
          suspension_reason: 'License pending state medical board renewal inquiry',
          reviewed_by: 1,
        }),
        expect.any(Object)
      );
    });

    test('PATCH /api/admin/doctors/:id/suspend - cannot suspend pending doctor', async () => {
      const fakeDoctor = DoctorProfile.build({
        id: 19,
        user_id: 209,
        status: DOCTOR_STATUS.PENDING,
      });

      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });
      jest.spyOn(DoctorProfile, 'findByPk').mockResolvedValue(fakeDoctor);

      const res = await request(app)
        .patch('/api/admin/doctors/19/suspend')
        .set('Cookie', [`token=${adminToken}`])
        .set('Content-Type', 'application/json')
        .send({
          reason: 'Investigation pending',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Cannot suspend doctor with status 'pending'/i);
    });

    test('GET /api/admin/doctors - doctor cannot access admin applications endpoint (403)', async () => {
      const res = await request(app)
        .get('/api/admin/doctors')
        .set('Cookie', [`token=${doctorToken}`]);

      expect(res.status).toBe(403);
    });
  });

  // =========================================================================
  // 5. PUBLIC DOCTOR CATALOG TESTS
  // =========================================================================
  describe('5. Public Doctor Catalog (Safe Projection & Status Filtering)', () => {
    test('GET /api/doctors - returns only approved doctors and excludes sensitive fields', async () => {
      const approvedDoctor = DoctorProfile.build({
        id: 1,
        specialization: 'Dermatology',
        qualification: 'MBBS, MD',
        consultation_fee: 400.0,
        bio: 'Skin specialist',
        status: DOCTOR_STATUS.APPROVED,
      });
      approvedDoctor.dataValues.user = { id: 101, name: 'Dr. Dermatologist' };

      jest.spyOn(DoctorProfile, 'findAndCountAll').mockResolvedValue({
        count: 1,
        rows: [approvedDoctor],
      });

      const res = await request(app).get('/api/doctors');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.doctors.length).toBe(1);

      const returnedDoc = res.body.data.doctors[0];
      expect(returnedDoc.specialization).toBe('Dermatology');
      expect(returnedDoc.user.name).toBe('Dr. Dermatologist');

      // Crucial security verifications: Sensitive fields are omitted
      expect(returnedDoc.user.password_hash).toBeUndefined();
      expect(returnedDoc.user.email).toBeUndefined();
      expect(returnedDoc.user.phone).toBeUndefined();
      expect(returnedDoc.approved_by).toBeUndefined();
      expect(returnedDoc.rejection_reason).toBeUndefined();
      expect(returnedDoc.suspension_reason).toBeUndefined();
    });

    test('GET /api/doctors/:id - returns 404 if doctor is not approved', async () => {
      // Sequelize query filters where: { status: 'approved' }, so pending returns null
      jest.spyOn(DoctorProfile, 'findOne').mockResolvedValue(null);

      const res = await request(app).get('/api/doctors/99');

      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/Approved doctor not found/i);
    });
  });
});
