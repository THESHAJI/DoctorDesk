'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('reschedule_requests', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      appointment_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'appointments',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      requested_by: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      suggested_slot_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'availability_slots',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      status: {
        type: Sequelize.ENUM('pending', 'confirmed', 'rejected', 'expired'),
        allowNull: false,
        defaultValue: 'pending',
      },
      reason: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      responded_at: {
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

    await queryInterface.addIndex('reschedule_requests', ['appointment_id'], {
      name: 'idx_reschedule_requests_appointment_id',
    });
    await queryInterface.addIndex('reschedule_requests', ['status'], {
      name: 'idx_reschedule_requests_status',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('reschedule_requests');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_reschedule_requests_status";');
  },
};
