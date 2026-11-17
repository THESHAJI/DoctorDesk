'use strict';

/**
 * Live PostgreSQL Test: Deterministic Reminder Concurrency & SKIP LOCKED Verification
 * Database: doctordesk (PostgreSQL, development)
 *
 * Explicit Synchronization Strategy:
 * 1. Worker A opens a managed transaction, claims due reminders with FOR UPDATE SKIP LOCKED,
 *    and pauses (holding the lock).
 * 2. Worker B executes while Worker A's transaction is actively open and holding locks.
 * 3. Asserts that Worker B skips Worker A's locked row and claims the next available due reminder.
 * 4. Worker A finishes and commits.
 * 5. Asserts both reminders are processed exactly once with zero collisions and zero deadlocks.
 */

process.env.NODE_ENV = 'development';

const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
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
  NOTIFICATION_TYPES,
} = require('../src/config/constants');

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

async function run() {
  const ts = Date.now();
  const password = 'Password@123';
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    await sequelize.authenticate();
    console.log('[SETUP] Connected to PostgreSQL development database.');

    // 1. Setup isolated test doctor and patient
    const docUser = await User.create({
      name: 'Dr. Concurrency Tester',
      email: `test_doc_cron_${ts}@test.local`,
      phone: `98765${String(ts).slice(-5)}`,
      password_hash: passwordHash,
      role: ROLES.DOCTOR,
    });
    tracked.userIds.push(docUser.id);

    const docProfile = await DoctorProfile.create({
      user_id: docUser.id,
      specialization: 'Pediatrics',
      qualification: 'MBBS, MD',
      experience_years: 8,
      consultation_fee: '600.00',
      status: DOCTOR_STATUS.APPROVED,
    });
    tracked.doctorProfileIds.push(docProfile.id);

    const patUser = await User.create({
      name: 'Patient Cron Tester',
      email: `test_pat_cron_${ts}@test.local`,
      phone: `98766${String(ts).slice(-5)}`,
      password_hash: passwordHash,
      role: ROLES.PATIENT,
    });
    tracked.userIds.push(patUser.id);

    // 2. Setup slots and booked appointments
    const futureDateStr = new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0];

    const slot1 = await AvailabilitySlot.create({
      doctor_profile_id: docProfile.id,
      slot_date: futureDateStr,
      start_time: '10:00:00',
      end_time: '10:30:00',
      status: SLOT_STATUS.BOOKED,
    });
    tracked.slotIds.push(slot1.id);

    const slot2 = await AvailabilitySlot.create({
      doctor_profile_id: docProfile.id,
      slot_date: futureDateStr,
      start_time: '11:00:00',
      end_time: '11:30:00',
      status: SLOT_STATUS.BOOKED,
    });
    tracked.slotIds.push(slot2.id);

    const appt1 = await Appointment.create({
      patient_id: patUser.id,
      doctor_profile_id: docProfile.id,
      slot_id: slot1.id,
      status: APPOINTMENT_STATUS.BOOKED,
      consultation_fee: '600.00',
      commission_amount: '60.00',
      total_fee: '660.00',
      commission_type: 'percentage',
      commission_value: 10,
      booked_at: new Date(),
    });
    tracked.appointmentIds.push(appt1.id);

    const appt2 = await Appointment.create({
      patient_id: patUser.id,
      doctor_profile_id: docProfile.id,
      slot_id: slot2.id,
      status: APPOINTMENT_STATUS.BOOKED,
      consultation_fee: '600.00',
      commission_amount: '60.00',
      total_fee: '660.00',
      commission_type: 'percentage',
      commission_value: 10,
      booked_at: new Date(),
    });
    tracked.appointmentIds.push(appt2.id);

    // 3. Seed 2 due reminder notifications (ordered by scheduled_for)
    const pastTime1 = new Date(Date.now() - 120000); // 2 minutes ago (Row 1)
    const pastTime2 = new Date(Date.now() - 60000);  // 1 minute ago (Row 2)

    const notif1 = await Notification.create({
      user_id: patUser.id,
      appointment_id: appt1.id,
      type: NOTIFICATION_TYPES.REMINDER_1HOUR,
      title: 'Reminder 1',
      message: 'Your appointment 1 is starting soon',
      is_read: false,
      is_sent: false,
      scheduled_for: pastTime1,
    });
    tracked.notificationIds.push(notif1.id);

    const notif2 = await Notification.create({
      user_id: patUser.id,
      appointment_id: appt2.id,
      type: NOTIFICATION_TYPES.REMINDER_1HOUR,
      title: 'Reminder 2',
      message: 'Your appointment 2 is starting soon',
      is_read: false,
      is_sent: false,
      scheduled_for: pastTime2,
    });
    tracked.notificationIds.push(notif2.id);

    console.log(`[TEST] Created 2 due reminders:`);
    console.log(`  - Reminder A (ID: ${notif1.id}, scheduled: ${pastTime1.toISOString()})`);
    console.log(`  - Reminder B (ID: ${notif2.id}, scheduled: ${pastTime2.toISOString()})`);

    // Synchronization barriers with 5-second safety timeout guards
    const withTimeout = (promise, ms, errorMsg) => {
      let timer;
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(errorMsg)), ms);
      });
      return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
    };

    let resolveLockHeld;
    let rejectLockHeld;
    const lockHeldPromise = new Promise((resolve, reject) => {
      resolveLockHeld = resolve;
      rejectLockHeld = reject;
    });

    let resolveWorkerBCanFinish;
    let rejectWorkerBCanFinish;
    const workerBCanFinishPromise = new Promise((resolve, reject) => {
      resolveWorkerBCanFinish = resolve;
      rejectWorkerBCanFinish = reject;
    });

    let workerAClaimedId = null;
    let workerBClaimedId = null;

    // Worker A: Claims the earliest row under lock, then waits
    const workerATask = sequelize.transaction(async (tA) => {
      try {
        const now = new Date();
        const claimedA = await Notification.findAll({
          where: {
            is_sent: false,
            scheduled_for: { [Op.lte]: now },
            id: [notif1.id, notif2.id],
          },
          order: [['scheduled_for', 'ASC']],
          limit: 1,
          lock: tA.LOCK.UPDATE,
          skipLocked: true,
          transaction: tA,
        });

        if (claimedA.length === 0) {
          throw new Error('Worker A failed to claim any due reminder');
        }

        workerAClaimedId = claimedA[0].id;
        console.log(`[WORKER A] Claimed & holding row lock on Reminder ID ${workerAClaimedId}...`);

        // Signal Worker B that lock is actively held
        resolveLockHeld();

        // Wait with 5s timeout until Worker B has completed its query under concurrency
        await withTimeout(
          workerBCanFinishPromise,
          5000,
          'Worker A timed out waiting for Worker B to complete'
        );

        // Mark sent and commit
        await claimedA[0].update({ is_sent: true, sent_at: new Date() }, { transaction: tA });
        console.log(`[WORKER A] Committed Reminder ID ${workerAClaimedId}.`);
      } catch (err) {
        rejectLockHeld(err);
        throw err;
      }
    });

    // Worker B: Executes concurrently while Worker A is still holding the lock
    const workerBTask = (async () => {
      try {
        // Wait with 5s timeout to ensure Worker A holds the lock first
        await withTimeout(
          lockHeldPromise,
          5000,
          'Worker B timed out waiting for Worker A to acquire lock'
        );
        console.log('[WORKER B] Attempting claim while Worker A actively holds row lock...');

        await sequelize.transaction(async (tB) => {
          const now = new Date();
          const claimedB = await Notification.findAll({
            where: {
              is_sent: false,
              scheduled_for: { [Op.lte]: now },
              id: [notif1.id, notif2.id],
            },
            order: [['scheduled_for', 'ASC']],
            limit: 1,
            lock: tB.LOCK.UPDATE,
            skipLocked: true,
            transaction: tB,
          });

          if (claimedB.length === 0) {
            throw new Error('Worker B found no available reminders (failed to SKIP LOCKED)');
          }

          workerBClaimedId = claimedB[0].id;
          console.log(`[WORKER B] Successfully skipped locked row and claimed Reminder ID ${workerBClaimedId}!`);

          await claimedB[0].update({ is_sent: true, sent_at: new Date() }, { transaction: tB });
          console.log(`[WORKER B] Committed Reminder ID ${workerBClaimedId}.`);
        });

        // Release Worker A to finish
        resolveWorkerBCanFinish();
      } catch (err) {
        rejectWorkerBCanFinish(err);
        throw err;
      }
    })();

    await Promise.all([workerATask, workerBTask]);

    // Verifications
    console.log('\n[VERIFICATION] Verifying concurrency assertion results:');
    console.log(`  - Worker A claimed ID: ${workerAClaimedId}`);
    console.log(`  - Worker B claimed ID: ${workerBClaimedId}`);

    if (workerAClaimedId === workerBClaimedId) {
      throw new Error(`Concurrency violation! Both workers claimed the same row ID: ${workerAClaimedId}`);
    }

    if (!workerAClaimedId || !workerBClaimedId) {
      throw new Error('One or both workers failed to claim a reminder');
    }

    // Verify in PostgreSQL that both are marked sent
    const reloadedNotif1 = await Notification.findByPk(notif1.id);
    const reloadedNotif2 = await Notification.findByPk(notif2.id);

    if (!reloadedNotif1.is_sent || !reloadedNotif1.sent_at) {
      throw new Error(`Reminder ${notif1.id} was not marked sent in database`);
    }
    if (!reloadedNotif2.is_sent || !reloadedNotif2.sent_at) {
      throw new Error(`Reminder ${notif2.id} was not marked sent in database`);
    }

    console.log('\n[PASS] Deterministic SKIP LOCKED row-lock contention verified successfully against PostgreSQL!');
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
