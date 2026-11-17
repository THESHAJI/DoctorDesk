'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('appointments', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      patient_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
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
      slot_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'availability_slots',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      status: {
        type: Sequelize.ENUM('booked', 'completed', 'cancelled', 'no_show', 'rescheduled'),
        allowNull: false,
        defaultValue: 'booked',
      },
      consultation_fee: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      commission_amount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      total_fee: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      commission_type: {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: 'percentage',
      },
      commission_value: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      cancellation_reason: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      booked_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
      completed_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      cancelled_at: {
        type: Sequelize.DATE,
        allowNull: true,
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

    // Enforce at database level: slot can only have one active appointment ('booked' or 'completed')
    // Partial unique index in PostgreSQL
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX unique_active_slot_booking 
      ON appointments (slot_id) 
      WHERE status IN ('booked', 'completed');
    `);

    await queryInterface.addIndex('appointments', ['patient_id'], {
      name: 'idx_appointments_patient_id',
    });
    await queryInterface.addIndex('appointments', ['doctor_profile_id'], {
      name: 'idx_appointments_doctor_profile_id',
    });
    await queryInterface.addIndex('appointments', ['status'], {
      name: 'idx_appointments_status',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('appointments');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_appointments_status";');
  },
};
