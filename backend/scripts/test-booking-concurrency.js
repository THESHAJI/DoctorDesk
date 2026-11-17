'use strict';

/**
 * Live PostgreSQL Booking Concurrency Test Harness
 * 
 * Verifies concurrency safety under simultaneous race conditions against a live PostgreSQL database:
 * 1. Creates isolated test fixtures: 1 approved doctor, 2 independent patients, 1 available future slot.
 * 2. Authenticates both patients independently via the real POST /api/auth/login endpoint.
 * 3. Dispatches two simultaneous POST /api/appointments requests for the exact same slot.
 * 4. Asserts that:
 *    - Exactly one request receives HTTP 201 Created.
 *    - Exactly one request receives HTTP 409 Conflict.
 *    - Database has exactly one appointment record for the slot.
 *    - Slot status has atomically transitioned to 'booked'.
 * 5. Cleans up strictly the records created by this test run in a finally block.
 */

require('dotenv').config();
const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const {
  sequelize,
  User,
  DoctorProfile,
  AvailabilitySlot,
  Appointment,
} = require('../src/models');
const {
  ROLES,
  DOCTOR_STATUS,
  SLOT_STATUS,
  APPOINTMENT_STATUS,
} = require('../src/config/constants');

async function runConcurrencyTest() {
  console.log('===============================================================');
  console.log('LIVE POSTGRESQL BOOKING CONCURRENCY TEST');
  console.log('Target Database:', sequelize.config.database);
  console.log('Target Host:', `${sequelize.config.host}:${sequelize.config.port}`);
  console.log('===============================================================\n');

  // Verify DB connection
  await sequelize.authenticate();
  console.log('✔ Connected to PostgreSQL database.\n');

  const uniqueSuffix = Date.now();
  const testDoctorEmail = `test-doc-${uniqueSuffix}@concurrency.test`;
  const testPatient1Email = `test-pat1-${uniqueSuffix}@concurrency.test`;
  const testPatient2Email = `test-pat2-${uniqueSuffix}@concurrency.test`;
  const rawPassword = 'TestPassword@123';

  // Primary key tracking for strictly scoped cleanup
  const createdIds = {
    userIds: [],
    doctorProfileIds: [],
    slotIds: [],
    appointmentIds: [],
  };

  try {
    // -------------------------------------------------------------------------
    // 1. CREATE ISOLATED TEST DATA
    // -------------------------------------------------------------------------
    console.log('Step 1: Creating isolated test fixtures...');
    const passwordHash = await bcrypt.hash(rawPassword, 10);
    const now = new Date();

    // Tomorrow's date for future slot
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const slotDate = tomorrow.toISOString().split('T')[0];

    // Create doctor user
    const doctorUser = await User.create({
      name: `Dr. Concurrency Test ${uniqueSuffix}`,
      email: testDoctorEmail,
      phone: '+91 9999900001',
      password_hash: passwordHash,
      role: ROLES.DOCTOR,
      is_active: true,
    });
    createdIds.userIds.push(doctorUser.id);

    // Create approved doctor profile
    const doctorProfile = await DoctorProfile.create({
      user_id: doctorUser.id,
      specialization: 'Concurrency Cardiology',
      qualification: 'MBBS, MD',
      consultation_fee: 500.0,
      bio: 'Isolated test profile for live database concurrency verification.',
      status: DOCTOR_STATUS.APPROVED,
      approved_at: now,
    });
    createdIds.doctorProfileIds.push(doctorProfile.id);

    // Create Patient 1
    const patient1User = await User.create({
      name: `Patient One ${uniqueSuffix}`,
      email: testPatient1Email,
      phone: '+91 9999900002',
      password_hash: passwordHash,
      role: ROLES.PATIENT,
      is_active: true,
    });
    createdIds.userIds.push(patient1User.id);

    // Create Patient 2
    const patient2User = await User.create({
      name: `Patient Two ${uniqueSuffix}`,
      email: testPatient2Email,
      phone: '+91 9999900003',
      password_hash: passwordHash,
      role: ROLES.PATIENT,
      is_active: true,
    });
    createdIds.userIds.push(patient2User.id);

    // Create 1 available future slot
    const slot = await AvailabilitySlot.create({
      doctor_profile_id: doctorProfile.id,
      slot_date: slotDate,
      start_time: '11:00:00',
      end_time: '11:30:00',
      status: SLOT_STATUS.AVAILABLE,
    });
    createdIds.slotIds.push(slot.id);

    console.log(`✔ Created Doctor (User ID: ${doctorUser.id}, Profile ID: ${doctorProfile.id})`);
    console.log(`✔ Created Patient 1 (User ID: ${patient1User.id})`);
    console.log(`✔ Created Patient 2 (User ID: ${patient2User.id})`);
    console.log(`✔ Created Availability Slot (Slot ID: ${slot.id}, Date: ${slotDate}, Time: 11:00:00 - 11:30:00)\n`);

    // -------------------------------------------------------------------------
    // 2. AUTHENTICATE BOTH PATIENTS INDEPENDENTLY
    // -------------------------------------------------------------------------
    console.log('Step 2: Authenticating patients independently via POST /api/auth/login...');

    const [loginRes1, loginRes2] = await Promise.all([
      request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send({ email: testPatient1Email, password: rawPassword }),
      request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send({ email: testPatient2Email, password: rawPassword }),
    ]);

    if (loginRes1.status !== 200 || !loginRes1.headers['set-cookie']) {
      throw new Error(`Patient 1 login failed with HTTP ${loginRes1.status}: ${JSON.stringify(loginRes1.body)}`);
    }
    if (loginRes2.status !== 200 || !loginRes2.headers['set-cookie']) {
      throw new Error(`Patient 2 login failed with HTTP ${loginRes2.status}: ${JSON.stringify(loginRes2.body)}`);
    }

    const cookie1 = loginRes1.headers['set-cookie'];
    const cookie2 = loginRes2.headers['set-cookie'];

    // Verify session tokens are distinct
    const token1 = cookie1[0];
    const token2 = cookie2[0];
    if (token1 === token2) {
      throw new Error('Security check failed: Patient 1 and Patient 2 received identical session tokens!');
    }
    console.log('✔ Patient 1 authenticated successfully (unique session cookie received).');
    console.log('✔ Patient 2 authenticated successfully (unique session cookie received).\n');

    // -------------------------------------------------------------------------
    // 3. EXECUTE SIMULTANEOUS RACE CONDITION (PROMISE.ALL)
    // -------------------------------------------------------------------------
    console.log(`Step 3: Dispatching simultaneous booking requests for Slot ID ${slot.id}...`);

    const bookingPayload = {
      slotId: slot.id,
      doctorProfileId: doctorProfile.id,
    };

    const startTime = Date.now();
    const [resA, resB] = await Promise.all([
      request(app)
        .post('/api/appointments')
        .set('Cookie', cookie1)
        .set('Content-Type', 'application/json')
        .send(bookingPayload),
      request(app)
        .post('/api/appointments')
        .set('Cookie', cookie2)
        .set('Content-Type', 'application/json')
        .send(bookingPayload),
    ]);
    const duration = Date.now() - startTime;
    console.log(`✔ Simultaneous requests resolved in ${duration}ms.\n`);

    // -------------------------------------------------------------------------
    // 4. VERIFY CONCURRENCY OUTCOMES
    // -------------------------------------------------------------------------
    console.log('Step 4: Evaluating responses and database state...');
    console.log(`Response A: HTTP ${resA.status}`, resA.body);
    console.log(`Response B: HTTP ${resB.status}`, resB.body);

    const statuses = [resA.status, resB.status].sort();

    // Check 4a: Exactly one 201 and exactly one 409
    if (statuses[0] !== 201 || statuses[1] !== 409) {
      throw new Error(
        `Concurrency failure! Expected [201, 409] but received [${resA.status}, ${resB.status}]. ` +
        `Details: Response A: ${JSON.stringify(resA.body)}, Response B: ${JSON.stringify(resB.body)}`
      );
    }
    console.log('✔ Status code assertion passed: exactly one HTTP 201 Created and one HTTP 409 Conflict.');

    // Check 4b: Conflict response payload structure
    const conflictRes = resA.status === 409 ? resA : resB;
    const successRes = resA.status === 201 ? resA : resB;

    if (!/already booked|no longer available/i.test(conflictRes.body?.message)) {
      console.warn('⚠ Note: Conflict error message was:', conflictRes.body?.message);
    } else {
      console.log('✔ Conflict response message verified:', conflictRes.body?.message);
    }

    // Check 4c: Database state verification
    const bookedAppointments = await Appointment.findAll({
      where: { slot_id: slot.id },
    });

    for (const appt of bookedAppointments) {
      createdIds.appointmentIds.push(appt.id);
    }

    if (bookedAppointments.length !== 1) {
      throw new Error(
        `Critical DB integrity violation! Expected exactly 1 appointment for Slot ID ${slot.id}, ` +
        `but found ${bookedAppointments.length} appointments in database!`
      );
    }
    console.log(`✔ Database assertion passed: exactly 1 appointment record exists (Appointment ID: ${bookedAppointments[0].id}).`);

    const soleAppointment = bookedAppointments[0];
    if (soleAppointment.status !== APPOINTMENT_STATUS.BOOKED) {
      throw new Error(`Expected appointment status to be 'booked', but got '${soleAppointment.status}'.`);
    }

    // Verify slot status in database
    const updatedSlot = await AvailabilitySlot.findByPk(slot.id);
    if (updatedSlot.status !== SLOT_STATUS.BOOKED) {
      throw new Error(
        `Slot status mismatch! Expected '${SLOT_STATUS.BOOKED}', but slot status is '${updatedSlot.status}'.`
      );
    }
    console.log('✔ Slot status verified: atomically transitioned from "available" to "booked".');

    // Verify correct patient association
    const winningPatientId = successRes.body?.data?.patientId || successRes.body?.data?.appointment?.patient_id;
    if (winningPatientId) {
      console.log(`✔ Winning Patient ID confirmed: ${winningPatientId}`);
    }

    console.log('\n===============================================================');
    console.log('🎉 LIVE POSTGRESQL CONCURRENCY TEST PASSED WITH ZERO VIOLATIONS');
    console.log('===============================================================\n');
    return { success: true };
  } catch (error) {
    console.error('\n❌ CONCURRENCY TEST FAILED:');
    console.error(error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    return { success: false, error };
  } finally {
    // -------------------------------------------------------------------------
    // 5. CLEANUP ISOLATED TEST FIXTURES
    // -------------------------------------------------------------------------
    console.log('Step 5: Cleaning up test fixtures...');
    try {
      if (createdIds.appointmentIds.length > 0) {
        const deletedAppts = await Appointment.destroy({
          where: { id: createdIds.appointmentIds },
        });
        console.log(`- Cleaned up ${deletedAppts} test appointment(s).`);
      }

      if (createdIds.slotIds.length > 0) {
        const deletedSlots = await AvailabilitySlot.destroy({
          where: { id: createdIds.slotIds },
        });
        console.log(`- Cleaned up ${deletedSlots} test availability slot(s).`);
      }

      if (createdIds.doctorProfileIds.length > 0) {
        const deletedProfiles = await DoctorProfile.destroy({
          where: { id: createdIds.doctorProfileIds },
        });
        console.log(`- Cleaned up ${deletedProfiles} test doctor profile(s).`);
      }

      if (createdIds.userIds.length > 0) {
        const deletedUsers = await User.destroy({
          where: { id: createdIds.userIds },
        });
        console.log(`- Cleaned up ${deletedUsers} test user(s).`);
      }

      console.log('✔ Isolated test fixtures cleaned up completely.');
      console.log('✔ Seeded demo data (users 1-4, profiles 1-2, slots 1-6) preserved intact.\n');
    } catch (cleanupErr) {
      console.error('⚠ Error during test cleanup:', cleanupErr.message);
    } finally {
      await sequelize.close();
      console.log('Database connection closed.');
    }
  }
}

// Allow direct CLI execution
if (require.main === module) {
  runConcurrencyTest().then((result) => {
    process.exit(result.success ? 0 : 1);
  });
}

module.exports = { runConcurrencyTest };
