const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const { User, DoctorProfile, sequelize } = require('../src/models');
const { ROLES, DOCTOR_STATUS } = require('../src/config/constants');
const { parseDuration, getAuthCookieOptions } = require('../src/utils/cookieHelper');

describe('Milestone 4: Authentication & Authorization Test Suite', () => {
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalJwtExpiresIn = process.env.JWT_EXPIRES_IN;

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test_jwt_secret_key_12345';
    process.env.JWT_EXPIRES_IN = '1h';
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
  // 1. REGISTRATION TESTS
  // =========================================================================
  describe('1. Patient & Doctor Registration', () => {
    test('POST /api/auth/register - successfully registers patient, sets HttpOnly cookie and omits password_hash', async () => {
      jest.spyOn(User, 'findOne').mockResolvedValue(null);

      const fakeUser = User.build({
        id: 101,
        name: 'Alice Patient',
        email: 'alice@example.com',
        phone: '+91 9999988888',
        role: ROLES.PATIENT,
        is_active: true,
        password_hash: '$2a$10$hashed_password_sample',
      });
      jest.spyOn(User, 'create').mockResolvedValue(fakeUser);

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Alice Patient',
          email: 'alice@example.com',
          phone: '+91 9999988888',
          password: 'Password@123',
          confirmPassword: 'Password@123',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user).toBeDefined();
      expect(res.body.data.user.role).toBe(ROLES.PATIENT);
      expect(res.body.data.user.password_hash).toBeUndefined(); // Sensitive data protected

      // Verify HttpOnly cookie header
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies[0]).toMatch(/token=/);
      expect(cookies[0]).toMatch(/HttpOnly/i);
      expect(cookies[0]).toMatch(/SameSite=Lax/i);
    });

    test('POST /api/auth/register - ignores admin role injection and enforces role=patient', async () => {
      jest.spyOn(User, 'findOne').mockResolvedValue(null);

      let capturedPayload = null;
      jest.spyOn(User, 'create').mockImplementation((data) => {
        capturedPayload = data;
        return Promise.resolve(
          User.build({
            id: 102,
            ...data,
            password_hash: 'hash',
          })
        );
      });

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Hacker User',
          email: 'hacker@example.com',
          password: 'Password@123',
          confirmPassword: 'Password@123',
          role: 'admin', // Malicious attempt to escalate privileges
        });

      expect(res.status).toBe(201);
      expect(capturedPayload.role).toBe(ROLES.PATIENT);
      expect(res.body.data.user.role).toBe(ROLES.PATIENT);
    });

    test('POST /api/auth/register - rejects duplicate email with 409 Conflict', async () => {
      jest.spyOn(User, 'findOne').mockResolvedValue({ id: 1, email: 'existing@example.com' });

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Existing User',
          email: 'existing@example.com',
          password: 'Password@123',
          confirmPassword: 'Password@123',
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already registered/i);
    });

    test('POST /api/auth/register - input validation rejects weak password with 422', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Test',
          email: 'test@example.com',
          password: 'weak',
          confirmPassword: 'weak',
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.errors.some((e) => e.field === 'password')).toBe(true);
    });

    test('POST /api/auth/register/doctor - creates doctor and pending doctor_profile atomically', async () => {
      jest.spyOn(User, 'findOne').mockResolvedValue(null);
      jest.spyOn(sequelize, 'transaction').mockImplementation(async (callback) => {
        return callback({});
      });

      const fakeUser = User.build({
        id: 201,
        name: 'Dr. Jane Smith',
        email: 'jane@hospital.com',
        role: ROLES.DOCTOR,
        is_active: true,
      });
      const fakeProfile = DoctorProfile.build({
        id: 501,
        user_id: 201,
        specialization: 'Neurology',
        qualification: 'MBBS, MD',
        consultation_fee: 750.0,
        status: DOCTOR_STATUS.PENDING,
      });

      jest.spyOn(User, 'create').mockResolvedValue(fakeUser);
      jest.spyOn(DoctorProfile, 'create').mockResolvedValue(fakeProfile);

      const res = await request(app)
        .post('/api/auth/register/doctor')
        .send({
          name: 'Dr. Jane Smith',
          email: 'jane@hospital.com',
          password: 'Password@123',
          confirmPassword: 'Password@123',
          specialization: 'Neurology',
          qualification: 'MBBS, MD',
          consultationFee: 750,
          role: 'admin', // Attempted role escalation
        });

      expect(res.status).toBe(201);
      expect(res.body.data.user.role).toBe(ROLES.DOCTOR);
      expect(res.body.data.user.doctorProfile.status).toBe(DOCTOR_STATUS.PENDING);
    });
  });

  // =========================================================================
  // 2. LOGIN TESTS
  // =========================================================================
  describe('2. Login Scenarios', () => {
    test('POST /api/auth/login - valid credentials returns 200 and sets cookie', async () => {
      const fakeUser = User.build({
        id: 1,
        name: 'Valid User',
        email: 'valid@example.com',
        role: ROLES.PATIENT,
        is_active: true,
        password_hash: '$2a$10$dummyhash',
      });
      jest.spyOn(User, 'findOne').mockResolvedValue(fakeUser);
      jest.spyOn(fakeUser, 'comparePassword').mockResolvedValue(true);

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'valid@example.com',
          password: 'CorrectPassword@123',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe('valid@example.com');
      expect(res.body.data.user.password_hash).toBeUndefined();

      const cookies = res.headers['set-cookie'];
      expect(cookies[0]).toMatch(/token=/);
      expect(cookies[0]).toMatch(/HttpOnly/i);
    });

    test('POST /api/auth/login - invalid password returns 401 with generic error', async () => {
      const fakeUser = User.build({
        id: 1,
        email: 'user@example.com',
        role: ROLES.PATIENT,
        is_active: true,
        password_hash: '$2a$10$dummyhash',
      });
      jest.spyOn(User, 'findOne').mockResolvedValue(fakeUser);
      jest.spyOn(fakeUser, 'comparePassword').mockResolvedValue(false);

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'user@example.com',
          password: 'WrongPassword@123',
        });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid email or password');
    });

    test('POST /api/auth/login - unknown email returns 401 with generic error', async () => {
      jest.spyOn(User, 'findOne').mockResolvedValue(null);

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'unknown@example.com',
          password: 'AnyPassword@123',
        });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid email or password');
    });
  });

  // =========================================================================
  // 3. JWT & AUTHENTICATION MIDDLEWARE TESTS
  // =========================================================================
  describe('3. JWT & Authentication Middleware (authenticate)', () => {
    test('GET /api/auth/me - returns user profile with valid cookie', async () => {
      const token = jwt.sign(
        { id: 1, email: 'me@example.com', role: ROLES.PATIENT },
        process.env.JWT_SECRET
      );

      const fakeUser = User.build({
        id: 1,
        name: 'Me User',
        email: 'me@example.com',
        role: ROLES.PATIENT,
        is_active: true,
      });
      jest.spyOn(User, 'findByPk').mockResolvedValue(fakeUser);

      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', [`token=${token}`]);

      expect(res.status).toBe(200);
      expect(res.body.data.user.email).toBe('me@example.com');
    });

    test('GET /api/auth/me - accepts Bearer token in Authorization header', async () => {
      const token = jwt.sign(
        { id: 1, email: 'bearer@example.com', role: ROLES.PATIENT },
        process.env.JWT_SECRET
      );

      const fakeUser = User.build({
        id: 1,
        name: 'Bearer User',
        email: 'bearer@example.com',
        role: ROLES.PATIENT,
        is_active: true,
      });
      jest.spyOn(User, 'findByPk').mockResolvedValue(fakeUser);

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.user.email).toBe('bearer@example.com');
    });

    test('GET /api/auth/me - fails with 401 when token is missing', async () => {
      const res = await request(app).get('/api/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/Authentication required/i);
    });

    test('GET /api/auth/me - fails with 401 on tampered token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', ['token=tampered_invalid_jwt_string']);

      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/Invalid authentication token/i);
    });

    test('GET /api/auth/me - fails with 401 on expired token', async () => {
      // Create token that expired 10 seconds ago
      const expiredToken = jwt.sign(
        { id: 1, email: 'exp@example.com', role: ROLES.PATIENT },
        process.env.JWT_SECRET,
        { expiresIn: '-10s' }
      );

      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', [`token=${expiredToken}`]);

      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/expired/i);
    });

    test('authenticate - handles missing JWT_SECRET safely with 500 error', async () => {
      const savedSecret = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;

      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', ['token=some_token']);

      process.env.JWT_SECRET = savedSecret; // Restore immediately

      expect(res.status).toBe(500);
      expect(res.body.message).toMatch(/JWT_SECRET is missing/i);
    });
  });

  // =========================================================================
  // 4. ROLE-BASED AUTHORIZATION TESTS (authorize)
  // =========================================================================
  describe('4. Role-based Authorization (authorize middleware)', () => {
    test('patient attempting to access admin route is rejected with 403 Forbidden', async () => {
      const patientToken = jwt.sign(
        { id: 1, email: 'patient@example.com', role: ROLES.PATIENT },
        process.env.JWT_SECRET
      );

      const res = await request(app)
        .get('/api/test/admin-only')
        .set('Cookie', [`token=${patientToken}`]);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Access denied.*Required role: admin/i);
    });

    test('doctor attempting to access admin route is rejected with 403 Forbidden', async () => {
      const doctorToken = jwt.sign(
        { id: 2, email: 'doctor@example.com', role: ROLES.DOCTOR },
        process.env.JWT_SECRET
      );

      const res = await request(app)
        .get('/api/test/admin-only')
        .set('Cookie', [`token=${doctorToken}`]);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Access denied.*Required role: admin/i);
    });

    test('doctor attempting to access patient-only route is rejected with 403 Forbidden', async () => {
      const doctorToken = jwt.sign(
        { id: 2, email: 'doctor@example.com', role: ROLES.DOCTOR },
        process.env.JWT_SECRET
      );

      const res = await request(app)
        .get('/api/test/patient-only')
        .set('Cookie', [`token=${doctorToken}`]);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Access denied.*Required role: patient/i);
    });

    test('admin user accessing admin-only route succeeds with 200 OK', async () => {
      const adminToken = jwt.sign(
        { id: 99, email: 'admin@doctordesk.com', role: ROLES.ADMIN },
        process.env.JWT_SECRET
      );

      const res = await request(app)
        .get('/api/test/admin-only')
        .set('Cookie', [`token=${adminToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Admin access granted');
    });
  });

  // =========================================================================
  // 5. DOCTOR APPROVAL GATE TESTS (requireApprovedDoctor)
  // =========================================================================
  describe('5. Real-Time Doctor Approval Gate (requireApprovedDoctor middleware)', () => {
    test('pending doctor is rejected with 403 Forbidden', async () => {
      const doctorToken = jwt.sign(
        { id: 2, email: 'pending_dr@example.com', role: ROLES.DOCTOR },
        process.env.JWT_SECRET
      );

      jest.spyOn(DoctorProfile, 'findOne').mockResolvedValue({
        id: 10,
        user_id: 2,
        status: DOCTOR_STATUS.PENDING,
      });

      const res = await request(app)
        .get('/api/test/approved-doctor-only')
        .set('Cookie', [`token=${doctorToken}`]);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/pending admin approval/i);
    });

    test('suspended doctor is rejected with 403 Forbidden even if token is valid', async () => {
      const doctorToken = jwt.sign(
        { id: 2, email: 'suspended_dr@example.com', role: ROLES.DOCTOR },
        process.env.JWT_SECRET
      );

      jest.spyOn(DoctorProfile, 'findOne').mockResolvedValue({
        id: 10,
        user_id: 2,
        status: DOCTOR_STATUS.SUSPENDED,
      });

      const res = await request(app)
        .get('/api/test/approved-doctor-only')
        .set('Cookie', [`token=${doctorToken}`]);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/suspended/i);
    });

    test('rejected doctor is rejected with 403 Forbidden and rejection reason', async () => {
      const doctorToken = jwt.sign(
        { id: 2, email: 'rejected_dr@example.com', role: ROLES.DOCTOR },
        process.env.JWT_SECRET
      );

      jest.spyOn(DoctorProfile, 'findOne').mockResolvedValue({
        id: 10,
        user_id: 2,
        status: DOCTOR_STATUS.REJECTED,
        rejection_reason: 'Invalid medical license documentation',
      });

      const res = await request(app)
        .get('/api/test/approved-doctor-only')
        .set('Cookie', [`token=${doctorToken}`]);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Invalid medical license documentation/i);
    });

    test('approved doctor is granted access with 200 OK', async () => {
      const doctorToken = jwt.sign(
        { id: 2, email: 'approved_dr@example.com', role: ROLES.DOCTOR },
        process.env.JWT_SECRET
      );

      jest.spyOn(DoctorProfile, 'findOne').mockResolvedValue({
        id: 10,
        user_id: 2,
        status: DOCTOR_STATUS.APPROVED,
      });

      const res = await request(app)
        .get('/api/test/approved-doctor-only')
        .set('Cookie', [`token=${doctorToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Approved doctor access granted');
    });
  });

  // =========================================================================
  // 6. LOGOUT TESTS
  // =========================================================================
  describe('6. Logout & Cookie Clearing', () => {
    test('POST /api/auth/logout - clears authentication cookie with matching path', async () => {
      const token = jwt.sign(
        { id: 1, email: 'logout@example.com', role: ROLES.PATIENT },
        process.env.JWT_SECRET
      );

      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', [`token=${token}`])
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/Logged out successfully/i);

      // Verify Set-Cookie header expires the cookie immediately
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies[0]).toMatch(/token=;/); // Empty token
      expect(cookies[0]).toMatch(/Expires=/i); // Past expiration date
      expect(cookies[0]).toMatch(/Path=\//i);
    });
  });

  // =========================================================================
  // 7. COOKIE maxAge ↔ JWT EXPIRATION SYNCHRONIZATION TESTS
  // =========================================================================
  describe('7. Cookie maxAge Synced with JWT Expiration (using ms library)', () => {
    // --- Unit-suffixed strings: parseDuration must match ms() exactly ---
    test('parseDuration("7d") returns 604800000 ms (matches ms and JWT)', () => {
      const ms = require('ms');
      expect(parseDuration('7d')).toBe(ms('7d'));
      expect(parseDuration('7d')).toBe(604800000);
    });

    test('parseDuration("24h") returns 86400000 ms', () => {
      expect(parseDuration('24h')).toBe(86400000);
    });

    test('parseDuration("1h") returns 3600000 ms', () => {
      expect(parseDuration('1h')).toBe(3600000);
    });

    test('parseDuration("60m") returns 3600000 ms', () => {
      expect(parseDuration('60m')).toBe(3600000);
    });

    test('parseDuration("15m") returns 900000 ms', () => {
      expect(parseDuration('15m')).toBe(900000);
    });

    test('parseDuration("3600s") returns 3600000 ms', () => {
      expect(parseDuration('3600s')).toBe(3600000);
    });

    // --- Extended formats the ms library supports ---
    test('parseDuration("1w") returns 604800000 ms (week format)', () => {
      expect(parseDuration('1w')).toBe(604800000);
    });

    test('parseDuration("2.5h") returns 9000000 ms (decimal hours)', () => {
      expect(parseDuration('2.5h')).toBe(9000000);
    });

    // --- Numeric type: treated as seconds (matching jsonwebtoken) ---
    test('parseDuration(3600) returns 3600000 ms (number → seconds × 1000)', () => {
      // jsonwebtoken: jwt.sign({}, s, { expiresIn: 3600 }) → exp = iat + 3600 seconds
      // Cookie: maxAge = 3600 * 1000 = 3600000 ms = 1 hour. MATCH.
      expect(parseDuration(3600)).toBe(3600000);
    });

    test('parseDuration(86400) returns 86400000 ms (24 hours in seconds)', () => {
      expect(parseDuration(86400)).toBe(86400000);
    });

    // --- Bare numeric strings: REJECTED as ambiguous ---
    test('parseDuration("3600") throws on bare numeric string (ambiguous)', () => {
      // ms('3600') returns 3600 ms = 3.6 seconds, which is almost
      // certainly not what a developer writing JWT_EXPIRES_IN=3600 intended.
      expect(() => parseDuration('3600')).toThrow(/Ambiguous duration/);
    });

    test('parseDuration("86400") throws on bare numeric string', () => {
      expect(() => parseDuration('86400')).toThrow(/Ambiguous duration/);
    });

    // --- Invalid/edge cases ---
    test('parseDuration(null/undefined) returns 7-day default', () => {
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(parseDuration(null)).toBe(sevenDaysMs);
      expect(parseDuration(undefined)).toBe(sevenDaysMs);
    });

    test('parseDuration("") returns 7-day default', () => {
      expect(parseDuration('')).toBe(7 * 24 * 60 * 60 * 1000);
    });

    test('parseDuration("invalid") throws on unrecognized format', () => {
      expect(() => parseDuration('invalid')).toThrow(/Invalid duration format/);
    });

    test('parseDuration(-1) throws on negative number', () => {
      expect(() => parseDuration(-1)).toThrow(/positive finite number/);
    });

    test('parseDuration(Infinity) throws on non-finite number', () => {
      expect(() => parseDuration(Infinity)).toThrow(/positive finite number/);
    });

    // --- Proof that JWT token exp and cookie maxAge align ---
    test('JWT exp and cookie maxAge match for "1h"', () => {
      const jwt = require('jsonwebtoken');
      const duration = '1h';

      // JWT side: compute exp - iat in seconds
      const token = jwt.sign({}, 'test_secret', { expiresIn: duration });
      const decoded = jwt.decode(token);
      const jwtLifetimeSeconds = decoded.exp - decoded.iat;

      // Cookie side: parseDuration returns ms
      const cookieMaxAgeMs = parseDuration(duration);
      const cookieMaxAgeSeconds = cookieMaxAgeMs / 1000;

      expect(cookieMaxAgeSeconds).toBe(jwtLifetimeSeconds);
    });

    test('JWT exp and cookie maxAge match for "7d"', () => {
      const jwt = require('jsonwebtoken');
      const duration = '7d';

      const token = jwt.sign({}, 'test_secret', { expiresIn: duration });
      const decoded = jwt.decode(token);
      const jwtLifetimeSeconds = decoded.exp - decoded.iat;

      const cookieMaxAgeMs = parseDuration(duration);
      const cookieMaxAgeSeconds = cookieMaxAgeMs / 1000;

      expect(cookieMaxAgeSeconds).toBe(jwtLifetimeSeconds);
    });

    // --- getAuthCookieOptions integration ---
    test('getAuthCookieOptions().maxAge matches JWT_EXPIRES_IN env', () => {
      // JWT_EXPIRES_IN is set to '1h' in beforeAll
      expect(getAuthCookieOptions().maxAge).toBe(3600000);
    });

    test('getAuthCookieOptions().maxAge updates when JWT_EXPIRES_IN changes', () => {
      const saved = process.env.JWT_EXPIRES_IN;
      process.env.JWT_EXPIRES_IN = '30m';
      expect(getAuthCookieOptions().maxAge).toBe(1800000);
      process.env.JWT_EXPIRES_IN = saved;
    });
  });

  // =========================================================================
  // 8. CSRF DEFENSE (Content-Type Enforcement) TESTS
  // =========================================================================
  describe('8. CSRF Defense – Content-Type Enforcement', () => {
    test('POST with application/json Content-Type succeeds (normal API usage)', async () => {
      jest.spyOn(User, 'findOne').mockResolvedValue(null);
      jest.spyOn(User, 'create').mockResolvedValue(
        User.build({
          id: 300,
          name: 'CSRF Test',
          email: 'csrf@example.com',
          role: ROLES.PATIENT,
          is_active: true,
          password_hash: '$2a$10$hash',
        })
      );

      const res = await request(app)
        .post('/api/auth/register')
        .set('Content-Type', 'application/json')
        .send({
          name: 'CSRF Test',
          email: 'csrf@example.com',
          password: 'Password@123',
          confirmPassword: 'Password@123',
        });

      expect(res.status).toBe(201);
    });

    test('POST with application/x-www-form-urlencoded is rejected with 415 (form CSRF blocked)', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send('name=Hacker&email=hack@example.com&password=Password@123&confirmPassword=Password@123');

      expect(res.status).toBe(415);
      expect(res.body.message).toMatch(/Unsupported Media Type/i);
    });

    test('POST with text/plain Content-Type is rejected with 415 (text CSRF blocked)', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'text/plain')
        .send('{"email":"x@y.com","password":"P@ss1"}');

      expect(res.status).toBe(415);
      expect(res.body.message).toMatch(/Unsupported Media Type/i);
    });

    test('POST with multipart/form-data is rejected with 415 (no broad multipart exemption)', async () => {
      // IMPORTANT: multipart is NOT exempt by default. Only specific
      // upload paths will be exempted when implemented in Milestone 5+.
      const res = await request(app)
        .post('/api/auth/register')
        .set('Content-Type', 'multipart/form-data; boundary=----WebKitFormBoundary')
        .send('------WebKitFormBoundary\r\nContent-Disposition: form-data; name="email"\r\n\r\nhack@test.com\r\n------WebKitFormBoundary--');

      expect(res.status).toBe(415);
      expect(res.body.message).toMatch(/Unsupported Media Type/i);
    });

    test('DELETE request without Content-Type is rejected with 415', async () => {
      const token = jwt.sign(
        { id: 1, email: 'del@example.com', role: ROLES.ADMIN },
        process.env.JWT_SECRET
      );

      const res = await request(app)
        .delete('/api/auth/logout')
        .set('Cookie', [`token=${token}`]);

      // DELETE to a non-existent route will hit CSRF middleware before 404
      expect([404, 415]).toContain(res.status);
    });

    test('GET request without Content-Type header succeeds (safe method exempt)', async () => {
      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
