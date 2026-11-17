'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Safety check: Verify if duplicate pending reschedule requests already exist
    const [duplicates] = await queryInterface.sequelize.query(`
      SELECT appointment_id, COUNT(*) AS pending_count
      FROM reschedule_requests
      WHERE status = 'pending'
      GROUP BY appointment_id
      HAVING COUNT(*) > 1;
    `);

    if (duplicates && duplicates.length > 0) {
      throw new Error(
        `Migration aborted: Found ${duplicates.length} appointment(s) with duplicate pending reschedule requests. Resolve duplicates before applying unique constraint.`
      );
    }

    // 2. Add partial unique index: exactly one pending reschedule request allowed per appointment
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX unique_pending_appointment_reschedule
      ON reschedule_requests (appointment_id)
      WHERE status = 'pending';
    `);
  },

  async down(queryInterface, Sequelize) {
    // Rollback removes strictly this partial unique index
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS unique_pending_appointment_reschedule;
    `);
  },
};
