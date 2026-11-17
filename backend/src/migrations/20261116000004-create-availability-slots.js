'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('availability_slots', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      doctor_profile_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'doctor_profiles',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      slot_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      start_time: {
        type: Sequelize.TIME,
        allowNull: false,
      },
      end_time: {
        type: Sequelize.TIME,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('available', 'booked', 'blocked'),
        allowNull: false,
        defaultValue: 'available',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
    });

    await queryInterface.addIndex(
      'availability_slots',
      ['doctor_profile_id', 'slot_date', 'start_time'],
      {
        unique: true,
        name: 'unique_doctor_slot_datetime',
      }
    );
    await queryInterface.addIndex('availability_slots', ['status'], {
      name: 'idx_availability_slots_status',
    });
    await queryInterface.addIndex('availability_slots', ['slot_date'], {
      name: 'idx_availability_slots_date',
    });

    // Enforce at database level: end_time must strictly be after start_time
    await queryInterface.sequelize.query(`
      ALTER TABLE availability_slots 
      ADD CONSTRAINT check_slot_end_after_start 
      CHECK (end_time > start_time);
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE availability_slots 
      DROP CONSTRAINT IF EXISTS check_slot_end_after_start;
    `);
    await queryInterface.dropTable('availability_slots');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_availability_slots_status";');
  },
};
