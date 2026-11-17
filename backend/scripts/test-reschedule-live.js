'use strict';

/**
 * Live PostgreSQL Test: Reschedule Workflows, Expiry, Fee Forwarding
 * Database: doctordesk (PostgreSQL, development)
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
      name: 'Dr. Reschedule Host',
      email: `test_doc_res_${ts}@test.local`,
      phone: `98765${String(ts).slice(-5)}`,
      password_hash: passwordHash,
      role: ROLES.DOCTOR,
    });
    tracked.userIds.push(docUser.id);

    const docProfile = await DoctorProfile.create({
      user_id: docUser.id,
      specialization: 'Neurology',
      qualification: 'MBBS, MD',
      experience_years: 10,
      consultation_fee: '800.00',
      status: DOCTOR_STATUS.APPROVED,
    });
    tracked.doctorProfileIds.push(docProfile.id);

    const patUser = await User.create({
      name: 'Patient Reschedule User',
      email: `test_pat_res_${ts}@test.local`,
      phone: `98766${String(ts).slice(-5)}`,
      password_hash: passwordHash,
      role: ROLES.PATIENT,
    });
    tracked.userIds.push(patUser.id);

    const futureDateStr1 = new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0];
    const futureDateStr2 = new Date(Date.now() + 86400000 * 4).toISOString().split('T')[0];

    const slotCurrent = await AvailabilitySlot.create({
      doctor_profile_id: docProfile.id,
      slot_date: futureDateStr1,
      start_time: '09:00:00',
      end_time: '09:30:00',
      status: SLOT_STATUS.AVAILABLE,
    });
    tracked.slotIds.push(slotCurrent.id);

    const slotSuggest = await AvailabilitySlot.create({
      doctor_profile_id: docProfile.id,
      slot_date: futureDateStr2,
      start_time: '14:00:00',
      end_time: '14:30:00',
      status: SLOT_STATUS.AVAILABLE,
    });
    tracked.slotIds.push(slotSuggest.id);

    const patCookie = await login(patUser.email, password);

    // Initial booking
    const bookRes = await request(app)
      .post('/api/appointments')
      .set('Cookie', patCookie)
      .set('Content-Type', 'application/json')
      .send({ slotId: slotCurrent.id });
    if (bookRes.status !== 201) throw new Error(`Initial booking failed: ${bookRes.status}`);
    const apptId = bookRes.body.data.appointment.id;
    tracked.appointmentIds.push(apptId);

    console.log('[TEST] Scenario 7: Patient requests reschedule...');
    const reqRes = await request(app)
      .post(`/api/appointments/${apptId}/reschedule`)
      .set('Cookie', patCookie)
      .set('Content-Type', 'application/json')
      .send({ reason: 'Need afternoon slot' });
    if (reqRes.status !== 201) throw new Error(`Expected 201, got ${reqRes.status}`);
    const reqId = reqRes.body.data.rescheduleRequestId;
    tracked.rescheduleRequestIds.push(reqId);

    console.log('[TEST] Scenario 8: Verify suggested slot remains available...');
    const reloadedSuggestSlot = await AvailabilitySlot.findByPk(slotSuggest.id);
    if (reloadedSuggestSlot.status !== SLOT_STATUS.AVAILABLE) throw new Error('Suggested slot should remain available');

    console.log('[TEST] Scenario 9: Duplicate reschedule request blocked...');
    const dupReqRes = await request(app)
      .post(`/api/appointments/${apptId}/reschedule`)
      .set('Cookie', patCookie)
      .set('Content-Type', 'application/json')
      .send({ reason: 'Duplicate attempt' });
    if (dupReqRes.status !== 409) throw new Error(`Expected 409 for duplicate request, got ${dupReqRes.status}`);

    console.log('[TEST] Scenario 10: View reschedule suggestion...');
    const suggRes = await request(app)
      .get(`/api/appointments/${apptId}/reschedule/suggestion`)
      .set('Cookie', patCookie);
    if (suggRes.status !== 200) throw new Error(`Expected 200, got ${suggRes.status}`);
    if (suggRes.body.data.suggestedSlot.id !== slotSuggest.id) throw new Error('Incorrect suggested slot returned');

    console.log('[TEST] Scenario 11: Confirm reschedule and verify state mutations...');
    const confirmRes = await request(app)
      .put(`/api/appointments/${apptId}/reschedule/confirm`)
      .set('Cookie', patCookie)
      .set('Content-Type', 'application/json')
      .send({});
    if (confirmRes.status !== 200) throw new Error(`Expected 200, got ${confirmRes.status}`);
    const newApptId = confirmRes.body.data.newAppointmentId;
    tracked.appointmentIds.push(newApptId);

    // Track doctor notification
    const docNotifs = await Notification.findAll({ where: { appointment_id: newApptId } });
    docNotifs.forEach((n) => tracked.notificationIds.push(n.id));

    const reloadedOldSlot = await AvailabilitySlot.findByPk(slotCurrent.id);
    const reloadedNewSlot = await AvailabilitySlot.findByPk(slotSuggest.id);
    const oldAppt = await Appointment.findByPk(apptId);
    const newAppt = await Appointment.findByPk(newApptId);

    if (reloadedOldSlot.status !== SLOT_STATUS.AVAILABLE) throw new Error('Old slot not marked available');
    if (reloadedNewSlot.status !== SLOT_STATUS.BOOKED) throw new Error('New slot not marked booked');
    if (oldAppt.status !== APPOINTMENT_STATUS.RESCHEDULED) throw new Error('Old appt not marked rescheduled');
    if (newAppt.status !== APPOINTMENT_STATUS.BOOKED) throw new Error('New appt not marked booked');

    console.log('[TEST] Scenario 12: Verify fee snapshots forwarded accurately...');
    if (Number(newAppt.consultation_fee) !== Number(oldAppt.consultation_fee) ||
        Number(newAppt.commission_amount) !== Number(oldAppt.commission_amount) ||
        Number(newAppt.total_fee) !== Number(oldAppt.total_fee) ||
        newAppt.commission_type !== oldAppt.commission_type) {
      throw new Error('Fee snapshot mismatch between old and new appointments');
    }

    console.log('[TEST] Scenario 13: Rejection workflow verification...');
    // Create another slot and appointment to test rejection
    const slotForReject1 = await AvailabilitySlot.create({
      doctor_profile_id: docProfile.id,
      slot_date: futureDateStr1,
      start_time: '16:00:00',
      end_time: '16:30:00',
      status: SLOT_STATUS.AVAILABLE,
    });
    tracked.slotIds.push(slotForReject1.id);

    const slotForReject2 = await AvailabilitySlot.create({
      doctor_profile_id: docProfile.id,
      slot_date: futureDateStr2,
      start_time: '16:00:00',
      end_time: '16:30:00',
      status: SLOT_STATUS.AVAILABLE,
    });
    tracked.slotIds.push(slotForReject2.id);

    const bookRejectRes = await request(app)
      .post('/api/appointments')
      .set('Cookie', patCookie)
      .set('Content-Type', 'application/json')
      .send({ slotId: slotForReject1.id });
    const apptRejectId = bookRejectRes.body.data.appointment.id;
    tracked.appointmentIds.push(apptRejectId);

    const reqRejectRes = await request(app)
      .post(`/api/appointments/${apptRejectId}/reschedule`)
      .set('Cookie', patCookie)
      .set('Content-Type', 'application/json')
      .send({ reason: 'Will reject this' });
    if (reqRejectRes.status !== 201) throw new Error(`Expected 201, got ${reqRejectRes.status}`);
    tracked.rescheduleRequestIds.push(reqRejectRes.body.data.rescheduleRequestId);

    const rejectRes = await request(app)
      .put(`/api/appointments/${apptRejectId}/reschedule/reject`)
      .set('Cookie', patCookie)
      .set('Content-Type', 'application/json')
      .send({});
    if (rejectRes.status !== 200) throw new Error(`Expected 200, got ${rejectRes.status}`);

    const reloadedReq = await RescheduleRequest.findByPk(reqRejectRes.body.data.rescheduleRequestId);
    if (reloadedReq.status !== RESCHEDULE_STATUS.REJECTED) throw new Error('Request status not rejected');
    const unchangedAppt = await Appointment.findByPk(apptRejectId);
    if (unchangedAppt.status !== APPOINTMENT_STATUS.BOOKED) throw new Error('Original appt did not remain booked');

    console.log('\n[PASS] All reschedule workflow & state transition tests passed successfully!');
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
