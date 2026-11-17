'use strict';

/**
 * Live PostgreSQL Test: Reschedule Concurrent Confirmation Competition
 * Database: doctordesk (PostgreSQL, development)
 *
 * Simulates two patients racing to confirm their reschedule onto the SAME single suggested slot.
 * Exactly one must succeed (200 OK), and the loser must receive conflict (409) with request marked expired.
 */

process.env.NODE_ENV = 'development';

const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const {
  sequelize,
  User,
  DoctorProfile,
  AvailabilitySlot,
  Appointment,
  RescheduleRequest,
  Notification,
} = require('../src/models');
const {
  ROLES,
  DOCTOR_STATUS,
  SLOT_STATUS,
  APPOINTMENT_STATUS,
  RESCHEDULE_STATUS,
} = require('../src/config/constants');

const tracked = {
  notificationIds: [],
  rescheduleRequestIds: [],
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
    if (tracked.rescheduleRequestIds.length) {
      await RescheduleRequest.destroy({ where: { id: tracked.rescheduleRequestIds } });
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
    throw new Error(`Login failed for ${email}: ${res.status}`);
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

    const docUser = await User.create({
      name: 'Dr. Concurrency Specialist',
      email: `test_doc_conc_${ts}@test.local`,
      phone: `98765${String(ts).slice(-5)}`,
      password_hash: passwordHash,
      role: ROLES.DOCTOR,
    });
    tracked.userIds.push(docUser.id);

    const docProfile = await DoctorProfile.create({
      user_id: docUser.id,
      specialization: 'Cardiology',
      qualification: 'MBBS, MD',
      experience_years: 12,
      consultation_fee: '1000.00',
      status: DOCTOR_STATUS.APPROVED,
    });
    tracked.doctorProfileIds.push(docProfile.id);

    const patA = await User.create({
      name: 'Patient Racer One',
      email: `test_pat_r1_${ts}@test.local`,
      phone: `98766${String(ts).slice(-5)}`,
      password_hash: passwordHash,
      role: ROLES.PATIENT,
    });
    tracked.userIds.push(patA.id);

    const patB = await User.create({
      name: 'Patient Racer Two',
      email: `test_pat_r2_${ts}@test.local`,
      phone: `98767${String(ts).slice(-5)}`,
      password_hash: passwordHash,
      role: ROLES.PATIENT,
    });
    tracked.userIds.push(patB.id);

    const futureDateStr1 = new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0];
    const futureDateStr2 = new Date(Date.now() + 86400000 * 4).toISOString().split('T')[0];

    // Slot for Patient A
    const slotA = await AvailabilitySlot.create({
      doctor_profile_id: docProfile.id,
      slot_date: futureDateStr1,
      start_time: '10:00:00',
      end_time: '10:30:00',
      status: SLOT_STATUS.AVAILABLE,
    });
    tracked.slotIds.push(slotA.id);

    // Slot for Patient B
    const slotB = await AvailabilitySlot.create({
      doctor_profile_id: docProfile.id,
      slot_date: futureDateStr1,
      start_time: '11:00:00',
      end_time: '11:30:00',
      status: SLOT_STATUS.AVAILABLE,
    });
    tracked.slotIds.push(slotB.id);

    // Single Target Slot both will want to reschedule to
    const targetSlot = await AvailabilitySlot.create({
      doctor_profile_id: docProfile.id,
      slot_date: futureDateStr2,
      start_time: '15:00:00',
      end_time: '15:30:00',
      status: SLOT_STATUS.AVAILABLE,
    });
    tracked.slotIds.push(targetSlot.id);

    const patACookie = await login(patA.email, password);
    const patBCookie = await login(patB.email, password);

    // Initial bookings
    const bookResA = await request(app)
      .post('/api/appointments')
      .set('Cookie', patACookie)
      .set('Content-Type', 'application/json')
      .send({ slotId: slotA.id });
    const apptAId = bookResA.body.data.appointment.id;
    tracked.appointmentIds.push(apptAId);

    const bookResB = await request(app)
      .post('/api/appointments')
      .set('Cookie', patBCookie)
      .set('Content-Type', 'application/json')
      .send({ slotId: slotB.id });
    const apptBId = bookResB.body.data.appointment.id;
    tracked.appointmentIds.push(apptBId);

    // Request reschedules - both will identify targetSlot as next available slot
    const reqResA = await request(app)
      .post(`/api/appointments/${apptAId}/reschedule`)
      .set('Cookie', patACookie)
      .set('Content-Type', 'application/json')
      .send({ reason: 'Racer A rescheduling' });
    if (reqResA.status !== 201) throw new Error(`Expected 201 for request A, got ${reqResA.status}`);
    const reqAId = reqResA.body.data.rescheduleRequestId;
    tracked.rescheduleRequestIds.push(reqAId);

    const reqResB = await request(app)
      .post(`/api/appointments/${apptBId}/reschedule`)
      .set('Cookie', patBCookie)
      .set('Content-Type', 'application/json')
      .send({ reason: 'Racer B rescheduling' });
    if (reqResB.status !== 201) throw new Error(`Expected 201 for request B, got ${reqResB.status}`);
    const reqBId = reqResB.body.data.rescheduleRequestId;
    tracked.rescheduleRequestIds.push(reqBId);

    console.log(`[TEST] Both requests created pointing to target slot ${targetSlot.id}.`);
    console.log('[CONCURRENCY TEST] Firing 2 simultaneous confirmation requests via Promise.all...');

    const [resA, resB] = await Promise.all([
      request(app)
        .put(`/api/appointments/${apptAId}/reschedule/confirm`)
        .set('Cookie', patACookie)
        .set('Content-Type', 'application/json')
        .send({}),
      request(app)
        .put(`/api/appointments/${apptBId}/reschedule/confirm`)
        .set('Cookie', patBCookie)
        .set('Content-Type', 'application/json')
        .send({}),
    ]);

    const statuses = [resA.status, resB.status];
    console.log(`[CONCURRENCY RESULT] Received responses: ${statuses.join(' and ')}`);

    const has200 = statuses.includes(200);
    const has409 = statuses.includes(409);

    if (!has200 || !has409) {
      throw new Error(`Expected exactly one 200 and one 409, got: ${statuses.join(', ')}`);
    }

    const winnerRes = resA.status === 200 ? resA : resB;
    const winnerApptId = winnerRes.body.data.newAppointmentId;
    tracked.appointmentIds.push(winnerApptId);

    // Track notifications
    const notifs = await Notification.findAll({ where: { appointment_id: winnerApptId } });
    notifs.forEach((n) => tracked.notificationIds.push(n.id));

    // Reload DB state
    const reloadedTarget = await AvailabilitySlot.findByPk(targetSlot.id);
    const targetAppointments = await Appointment.findAll({
      where: { slot_id: targetSlot.id, status: APPOINTMENT_STATUS.BOOKED },
    });

    console.log(`[VERIFICATION] Target slot status: ${reloadedTarget.status}`);
    console.log(`[VERIFICATION] Active appointments for target slot: ${targetAppointments.length}`);

    if (reloadedTarget.status !== SLOT_STATUS.BOOKED) {
      throw new Error('Target slot was not marked as booked');
    }

    if (targetAppointments.length !== 1) {
      throw new Error(`Expected exactly 1 booked appointment for target slot, found ${targetAppointments.length}`);
    }

    // Check expired status on losing request
    const loserReqId = resA.status === 409 ? reqAId : reqBId;
    const loserReq = await RescheduleRequest.findByPk(loserReqId);
    console.log(`[VERIFICATION] Loser reschedule request status: ${loserReq.status}`);

    if (loserReq.status !== RESCHEDULE_STATUS.EXPIRED) {
      throw new Error(`Expected loser reschedule request to be marked expired, got ${loserReq.status}`);
    }

    console.log('\n[PASS] Reschedule concurrency & slot contention safety fully verified on live PostgreSQL!');
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
