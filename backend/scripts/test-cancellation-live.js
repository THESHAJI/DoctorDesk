'use strict';

/**
 * Live PostgreSQL Test: Cancellation Workflows & Boundary Rules
 * Database: doctordesk (PostgreSQL, development)
 */

process.env.NODE_ENV = 'development';

const request = require('supertest');
const assert = require('assert');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const {
  sequelize,
  User,
  DoctorProfile,
  AvailabilitySlot,
  Appointment,
  Notification,
} = require('../src/models');
const {
  ROLES,
  DOCTOR_STATUS,
  SLOT_STATUS,
  APPOINTMENT_STATUS,
} = require('../src/config/constants');
const { getClinicDateTime } = require('../src/utils/timezone');

const tracked = {
  notificationIds: [],
  appointmentIds: [],
  slotIds: [],
  doctorProfileIds: [],
  userIds: [],
};

async function cleanup() {
  console.log('\n[CLEANUP] Cleaning up test-created records in reverse FK order...');
  try {
    if (tracked.notificationIds.length) {
      await Notification.destroy({ where: { id: tracked.notificationIds } });
    }
    if (tracked.appointmentIds.length) {
      await Appointment.destroy({ where: { id: tracked.appointmentIds } });
    }
    if (tracked.slotIds.length) {
      await AvailabilitySlot.destroy({ where: { id: tracked.slotIds } });
    }
    if (tracked.doctorProfileIds.length) {
      await DoctorProfile.destroy({ where: { id: tracked.doctorProfileIds } });
    }
    if (tracked.userIds.length) {
      await User.destroy({ where: { id: tracked.userIds } });
    }
    console.log('[CLEANUP] Successfully removed test fixtures.');
  } catch (err) {
    console.error('[CLEANUP ERROR]', err.message);
  }
}

async function login(email, password) {
  const res = await request(app)
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const cookies = res.headers['set-cookie'];
  if (!cookies) throw new Error(`No cookie returned for ${email}`);
  return cookies[0].split(';')[0];
}

async function run() {
  const ts = Date.now();
  const password = 'Password@123';
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    await sequelize.authenticate();
    console.log('[SETUP] Connected to PostgreSQL development database.');

    // 1. Setup Users & Profiles
    const docUserA = await User.create({
      name: 'Dr. Cancel Alpha',
      email: `test_doc_a_${ts}@test.local`,
      phone: `98765${String(ts).slice(-5)}`,
      password_hash: passwordHash,
      role: ROLES.DOCTOR,
    });
    tracked.userIds.push(docUserA.id);

    const docProfileA = await DoctorProfile.create({
      user_id: docUserA.id,
      specialization: 'General',
      qualification: 'MBBS, MD',
      experience_years: 5,
      consultation_fee: '500.00',
      status: DOCTOR_STATUS.APPROVED,
    });
    tracked.doctorProfileIds.push(docProfileA.id);

    const docUserB = await User.create({
      name: 'Dr. Cancel Beta',
      email: `test_doc_b_${ts}@test.local`,
      phone: `98766${String(ts).slice(-5)}`,
      password_hash: passwordHash,
      role: ROLES.DOCTOR,
    });
    tracked.userIds.push(docUserB.id);

    const docProfileB = await DoctorProfile.create({
      user_id: docUserB.id,
      specialization: 'General',
      qualification: 'MBBS, MD',
      experience_years: 5,
      consultation_fee: '500.00',
      status: DOCTOR_STATUS.APPROVED,
    });
    tracked.doctorProfileIds.push(docProfileB.id);

    const patUserA = await User.create({
      name: 'Patient Cancel Alpha',
      email: `test_pat_a_${ts}@test.local`,
      phone: `98767${String(ts).slice(-5)}`,
      password_hash: passwordHash,
      role: ROLES.PATIENT,
    });
    tracked.userIds.push(patUserA.id);

    const patUserB = await User.create({
      name: 'Patient Cancel Beta',
      email: `test_pat_b_${ts}@test.local`,
      phone: `98768${String(ts).slice(-5)}`,
      password_hash: passwordHash,
      role: ROLES.PATIENT,
    });
    tracked.userIds.push(patUserB.id);

    // Date calculations using clinic timezone
    const nowClinic = getClinicDateTime(new Date());
    const tomorrow = new Date(Date.now() + 86400000 * 2);
    const futureDateStr = tomorrow.toISOString().split('T')[0];

    // Slots
    const slotFuture1 = await AvailabilitySlot.create({
      doctor_profile_id: docProfileA.id,
      slot_date: futureDateStr,
      start_time: '10:00:00',
      end_time: '10:30:00',
      status: SLOT_STATUS.AVAILABLE,
    });
    tracked.slotIds.push(slotFuture1.id);

    const slotFuture2 = await AvailabilitySlot.create({
      doctor_profile_id: docProfileA.id,
      slot_date: futureDateStr,
      start_time: '11:00:00',
      end_time: '11:30:00',
      status: SLOT_STATUS.AVAILABLE,
    });
    tracked.slotIds.push(slotFuture2.id);

    // Slot within 24 hours (today, starting in 2 hours if feasible, or today near end)
    const slotNear = await AvailabilitySlot.create({
      doctor_profile_id: docProfileA.id,
      slot_date: nowClinic.date,
      start_time: '23:00:00',
      end_time: '23:30:00',
      status: SLOT_STATUS.AVAILABLE,
    });
    tracked.slotIds.push(slotNear.id);

    const patACookie = await login(patUserA.email, password);
    const patBCookie = await login(patUserB.email, password);
    const docACookie = await login(docUserA.email, password);
    const docBCookie = await login(docUserB.email, password);

    // Book appointments
    const bookRes1 = await request(app)
      .post('/api/appointments')
      .set('Cookie', patACookie)
      .set('Content-Type', 'application/json')
      .send({ slotId: slotFuture1.id });
    if (bookRes1.status !== 201) throw new Error(`Booking 1 failed: ${bookRes1.status}`);
    const appt1Id = bookRes1.body.data.appointment.id;
    tracked.appointmentIds.push(appt1Id);

    const bookRes2 = await request(app)
      .post('/api/appointments')
      .set('Cookie', patACookie)
      .set('Content-Type', 'application/json')
      .send({ slotId: slotFuture2.id });
    if (bookRes2.status !== 201) throw new Error(`Booking 2 failed: ${bookRes2.status}`);
    const appt2Id = bookRes2.body.data.appointment.id;
    tracked.appointmentIds.push(appt2Id);

    const bookResNear = await request(app)
      .post('/api/appointments')
      .set('Cookie', patACookie)
      .set('Content-Type', 'application/json')
      .send({ slotId: slotNear.id });
    if (bookResNear.status !== 201) throw new Error(`Booking Near failed: ${bookResNear.status}`);
    const apptNearId = bookResNear.body.data.appointment.id;
    tracked.appointmentIds.push(apptNearId);

    console.log('[TEST] Executing Scenario 1: Patient cancels own booked appointment (>24h)...');
    const cancelPatRes = await request(app)
      .patch(`/api/appointments/${appt1Id}/cancel`)
      .set('Cookie', patACookie)
      .set('Content-Type', 'application/json')
      .send({ reason: 'Patient changed plans' });
    if (cancelPatRes.status !== 200) throw new Error(`Expected 200, got ${cancelPatRes.status}`);
    const reloadedSlot1 = await AvailabilitySlot.findByPk(slotFuture1.id);
    if (reloadedSlot1.status !== SLOT_STATUS.AVAILABLE) throw new Error('Slot status not available');

    console.log('[TEST] Executing Scenario 2: Double cancellation rejection...');
    const doubleCancelRes = await request(app)
      .patch(`/api/appointments/${appt1Id}/cancel`)
      .set('Cookie', patACookie)
      .set('Content-Type', 'application/json')
      .send({ reason: 'Try cancel again' });
    assert.equal(doubleCancelRes.status, 409);

    console.log('[TEST] Executing Scenario 3: Cross-patient cancellation rejection...');
    const crossPatRes = await request(app)
      .patch(`/api/appointments/${appt2Id}/cancel`)
      .set('Cookie', patBCookie)
      .set('Content-Type', 'application/json')
      .send({ reason: 'Hacker cancel' });
    if (crossPatRes.status !== 403) throw new Error(`Expected 403, got ${crossPatRes.status}`);

    console.log('[TEST] Executing Scenario 4: Cross-doctor cancellation rejection...');
    const crossDocRes = await request(app)
      .patch(`/api/appointments/${appt2Id}/cancel`)
      .set('Cookie', docBCookie)
      .set('Content-Type', 'application/json')
      .send({ reason: 'Doctor B cancel attempt' });
    if (crossDocRes.status !== 403) throw new Error(`Expected 403, got ${crossDocRes.status}`);

    console.log('[TEST] Executing Scenario 5: Doctor cancellation with mandatory reason ≥5 chars...');
    const docShortReasonRes = await request(app)
      .patch(`/api/appointments/${appt2Id}/cancel`)
      .set('Cookie', docACookie)
      .set('Content-Type', 'application/json')
      .send({ reason: 'Sick' });
    if (docShortReasonRes.status !== 400) throw new Error(`Expected 400 for short reason, got ${docShortReasonRes.status}`);

    const docValidCancelRes = await request(app)
      .patch(`/api/appointments/${appt2Id}/cancel`)
      .set('Cookie', docACookie)
      .set('Content-Type', 'application/json')
      .send({ reason: 'Doctor is unwell today' });
    if (docValidCancelRes.status !== 200) throw new Error(`Expected 200, got ${docValidCancelRes.status}`);

    // Track created notification
    const notifs = await Notification.findAll({ where: { appointment_id: appt2Id } });
    notifs.forEach((n) => tracked.notificationIds.push(n.id));

    console.log('[TEST] Executing Scenario 6: Cancellation within 24 hours rejection...');
    const cancelNearRes = await request(app)
      .patch(`/api/appointments/${apptNearId}/cancel`)
      .set('Cookie', patACookie)
      .set('Content-Type', 'application/json')
      .send({ reason: 'Too late' });
    if (cancelNearRes.status !== 400) throw new Error(`Expected 400, got ${cancelNearRes.status}`);

    console.log('\n[PASS] All cancellation workflow & safety checks passed successfully!');
  } finally {
    await cleanup();
    await sequelize.close();
  }
}

if (require.main === module) {
  run().catch((err) => {
    console.error('[FAIL]', err);
    process.exit(1);
  });
}

module.exports = { run };
