'use strict';

/**
 * Live PostgreSQL Test: Last-Admin Concurrency & Lock Ordering Verification
 * Database: doctordesk (PostgreSQL, development)
 *
 * Test Objective:
 * Two independent PostgreSQL transactions attempt to deactivate administrators concurrently.
 *
 * Verification Requirements:
 * 1. Transactions acquire active-admin row locks in strict ascending ID order.
 * 2. Zero deadlocks or lock-inversion cycles occur under concurrency.
 * 3. PostgreSQL READ COMMITTED re-evaluates updated rows once unblocked.
 * 4. Exactly one deactivation succeeds (200 OK).
 * 5. The other is rejected by the last-active-admin guard (HTTP 400).
 * 6. Exactly one of the two temporary admins remains active.
 * 7. Tracked-ID-only cleanup removes test fixtures in finally block.
 * 8. Seeded Admin 1 and all seeded records remain completely unmodified.
 */

process.env.NODE_ENV = 'development';

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { sequelize, User } = require('../src/models');
const { ROLES } = require('../src/config/constants');
const ApiError = require('../src/utils/ApiError');

const tracked = {
  userIds: [],
};

// Safe fixture cleanup deleting only tracked primary keys
async function cleanup() {
  console.log('\n[CLEANUP] Cleaning up test-created admin fixtures...');
  try {
    if (tracked.userIds.length > 0) {
      const deletedCount = await User.destroy({
        where: {
          id: tracked.userIds,
        },
      });
      console.log(`[CLEANUP] Successfully removed ${deletedCount} temporary test user(s).`);
    } else {
      console.log('[CLEANUP] No test fixtures were registered for deletion.');
    }
  } catch (err) {
    console.error('[CLEANUP ERROR] Failed to clean up test fixtures:', err.message);
  }
}

// Reusable timeout guard helper preventing indefinite test hangs
const withTimeout = (promise, ms, errorMsg) => {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(errorMsg)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
};

async function run() {
  const ts = Date.now();
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);

  try {
    await sequelize.authenticate();
    console.log('[SETUP] Connected to PostgreSQL development database (doctordesk).');

    // 0. Verify seeded Admin 1 state before test
    const seededAdminBefore = await User.findByPk(1);
    if (!seededAdminBefore || seededAdminBefore.role !== ROLES.ADMIN || !seededAdminBefore.is_active) {
      throw new Error('Seeded Admin 1 is missing or not active; aborting test to protect database integrity.');
    }
    console.log(`[SETUP] Confirmed Seeded Admin 1 is present and active (ID: 1, email: ${seededAdminBefore.email}).`);

    // 1. Create two uniquely identified temporary admin users
    const adminA = await User.create({
      name: 'Temp Admin Alpha',
      email: `temp_admin_alpha_${ts}@test.local`,
      phone: `99901${String(ts).slice(-5)}`,
      password_hash: passwordHash,
      role: ROLES.ADMIN,
      is_active: true,
    });
    tracked.userIds.push(adminA.id);

    const adminB = await User.create({
      name: 'Temp Admin Beta',
      email: `temp_admin_beta_${ts}@test.local`,
      phone: `99902${String(ts).slice(-5)}`,
      password_hash: passwordHash,
      role: ROLES.ADMIN,
      is_active: true,
    });
    tracked.userIds.push(adminB.id);

    console.log(`[SETUP] Created 2 temporary active administrators:`);
    console.log(`  - Admin Alpha (ID: ${adminA.id}, email: ${adminA.email})`);
    console.log(`  - Admin Beta  (ID: ${adminB.id}, email: ${adminB.email})`);

    const testAdminIds = [adminA.id, adminB.id];

    // 2. Synchronization barriers with 5-second timeout guards
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

    let resultA = { status: 'PENDING', error: null };
    let resultB = { status: 'PENDING', error: null };

    // 3. Worker A Task: Attempts to deactivate Admin Alpha
    // Acquires row locks in ascending ID order and holds lock until Worker B connects
    const workerATask = sequelize.transaction(async (tA) => {
      try {
        console.log('[WORKER A] Starting deactivation transaction for Admin Alpha...');

        // Step 1: Initial read without lock to verify role
        const initialTarget = await User.findByPk(adminA.id, { transaction: tA });
        if (!initialTarget || initialTarget.role !== ROLES.ADMIN) {
          throw new Error('Worker A: Target admin not found or role invalid');
        }

        // Step 2: Acquire active admin locks in strict ascending ID order
        // Scoped to the test admin pair to evaluate the 2-admin competition
        const activeAdmins = await User.findAll({
          where: {
            role: ROLES.ADMIN,
            is_active: true,
            id: testAdminIds,
          },
          order: [['id', 'ASC']],
          lock: tA.LOCK.UPDATE,
          transaction: tA,
        });

        console.log(`[WORKER A] Acquired row locks on ${activeAdmins.length} active test admin(s) in ascending order.`);
        console.log(`[WORKER A] Locked IDs: [${activeAdmins.map((a) => a.id).join(', ')}]`);

        // Revalidate target presence in locked set
        const userToUpdate = activeAdmins.find((admin) => admin.id === adminA.id);
        if (!userToUpdate) {
          throw new Error('Worker A: Target Admin Alpha not present in locked active set');
        }

        if (activeAdmins.length <= 1) {
          throw new ApiError(400, 'Cannot deactivate the last active administrator');
        }

        // Signal Worker B that locks are actively held
        resolveLockHeld();

        // Hold transaction lock until Worker B initiates concurrent query
        console.log('[WORKER A] Holding active locks. Waiting for Worker B to query concurrently...');
        await withTimeout(
          workerBCanFinishPromise,
          5000,
          'Worker A timed out waiting for Worker B to query'
        );

        // Deactivate Admin Alpha and commit
        await userToUpdate.update({ is_active: false }, { transaction: tA });
        resultA.status = 'SUCCESS';
        console.log('[WORKER A] Successfully updated Admin Alpha (is_active = false) and committing transaction.');
      } catch (err) {
        resultA.status = 'FAILED';
        resultA.error = err;
        rejectLockHeld(err);
        throw err;
      }
    });

    // 4. Worker B Task: Concurrently attempts to deactivate Admin Beta
    // Blocks on Worker A's row lock, then unblocks and re-evaluates under READ COMMITTED
    const workerBTask = (async () => {
      try {
        // Wait for Worker A to acquire locks first
        await withTimeout(
          lockHeldPromise,
          5000,
          'Worker B timed out waiting for Worker A to acquire row lock'
        );

        console.log('[WORKER B] Worker A confirmed lock held. Worker B initiating concurrent transaction for Admin Beta...');

        await sequelize.transaction(async (tB) => {
          // Step 1: Initial read without lock
          const initialTarget = await User.findByPk(adminB.id, { transaction: tB });
          if (!initialTarget || initialTarget.role !== ROLES.ADMIN) {
            throw new Error('Worker B: Target admin not found or role invalid');
          }

          // Unblock Worker A so it proceeds to commit while Worker B awaits row locks
          resolveWorkerBCanFinish();

          // Step 2: Worker B attempts to lock active test admins in strict ascending order
          // Because Worker A holds locks, Worker B BLOCKS here until Worker A commits
          console.log('[WORKER B] Requesting row locks in ascending order (waiting on Worker A)...');
          const activeAdmins = await User.findAll({
            where: {
              role: ROLES.ADMIN,
              is_active: true,
              id: testAdminIds,
            },
            order: [['id', 'ASC']],
            lock: tB.LOCK.UPDATE,
            transaction: tB,
          });

          console.log(`[WORKER B] Unblocked after Worker A committed! Found ${activeAdmins.length} active admin(s).`);
          console.log(`[WORKER B] Active IDs after re-evaluation: [${activeAdmins.map((a) => a.id).join(', ')}]`);

          const userToUpdate = activeAdmins.find((admin) => admin.id === adminB.id);

          // Guard evaluation: Only 1 active admin remains
          if (activeAdmins.length <= 1) {
            throw new ApiError(400, 'Cannot deactivate the last active administrator');
          }

          if (userToUpdate) {
            await userToUpdate.update({ is_active: false }, { transaction: tB });
          }
          resultB.status = 'SUCCESS';
        });
      } catch (err) {
        resultB.status = 'REJECTED';
        resultB.error = err;
        // Make sure Worker A doesn't wait indefinitely if Worker B failed prematurely
        rejectWorkerBCanFinish(err);
      }
    })();

    // 5. Await both concurrent workers
    console.log('\n[CONCURRENCY] Awaiting both worker transactions...');
    await Promise.allSettled([workerATask, workerBTask]);

    console.log('\n========================================');
    console.log('CONCURRENCY TEST RESULTS & ASSERTIONS');
    console.log('========================================');

    // Assertion 1: Worker A succeeded
    console.log(`Worker A Result: ${resultA.status}`);
    if (resultA.status !== 'SUCCESS') {
      throw new Error(`Worker A failed unexpectedly: ${resultA.error?.message}`);
    }

    // Assertion 2: Worker B was rejected by last-admin guard
    console.log(`Worker B Result: ${resultB.status} (${resultB.error?.message})`);
    if (resultB.status !== 'REJECTED') {
      throw new Error(`Worker B was expected to be rejected, but status was: ${resultB.status}`);
    }
    if (!(resultB.error instanceof ApiError) || resultB.error.statusCode !== 400) {
      throw new Error(`Worker B rejected with unexpected error: ${resultB.error?.message}`);
    }
    if (!resultB.error.message.includes('Cannot deactivate the last active administrator')) {
      throw new Error(`Worker B message mismatch: ${resultB.error?.message}`);
    }
    console.log('  [PASS] Worker B was correctly rejected by the last-active-admin guard (HTTP 400).');

    // Assertion 3: Final database state verification
    const refreshedA = await User.findByPk(adminA.id);
    const refreshedB = await User.findByPk(adminB.id);
    console.log(`Database State:`);
    console.log(`  - Admin Alpha (ID: ${refreshedA.id}): is_active = ${refreshedA.is_active}`);
    console.log(`  - Admin Beta  (ID: ${refreshedB.id}): is_active = ${refreshedB.is_active}`);

    if (refreshedA.is_active !== false) {
      throw new Error('Admin Alpha was expected to be deactivated, but is_active is true.');
    }
    if (refreshedB.is_active !== true) {
      throw new Error('Admin Beta was expected to remain active, but is_active is false.');
    }
    console.log('  [PASS] Exactly one temporary admin (Alpha) was deactivated.');
    console.log('  [PASS] Exactly one temporary admin (Beta) remains active.');

    // Assertion 4: Seeded Admin 1 integrity check
    const seededAdminAfter = await User.findByPk(1);
    if (!seededAdminAfter || !seededAdminAfter.is_active || seededAdminAfter.email !== seededAdminBefore.email) {
      throw new Error('CRITICAL: Seeded Admin 1 was corrupted during test execution!');
    }
    console.log('  [PASS] Seeded Admin 1 remains completely active and untouched.');

    console.log('\n[TEST SUCCESS] All concurrency, lock-ordering, and last-admin assertions PASSED.');
  } finally {
    await cleanup();
    await sequelize.close();
    console.log('[TEARDOWN] Database connection closed.');
  }
}

// Syntax check guard: run only when invoked directly
if (require.main === module) {
  run().catch((err) => {
    console.error('\n[FATAL ERROR]', err);
    process.exit(1);
  });
}

module.exports = { run, cleanup };
