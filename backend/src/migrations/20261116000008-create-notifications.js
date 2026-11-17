'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('notifications', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      appointment_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'appointments',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      type: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      title: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      message: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      is_read: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      is_sent: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      scheduled_for: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      sent_at: {
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

    await queryInterface.addIndex('notifications', ['user_id', 'is_read'], {
      name: 'idx_notifications_user_read',
    });
    await queryInterface.addIndex('notifications', ['is_sent', 'scheduled_for'], {
      name: 'idx_notifications_scheduler',
    });

    // Enforce at database level: only one notification of a specific type
    // per user and appointment (prevents duplicate 1-day, 1-hour, 15-min reminders)
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX unique_appointment_notification_type 
      ON notifications (user_id, appointment_id, type) 
      WHERE appointment_id IS NOT NULL;
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS unique_appointment_notification_type;');
    await queryInterface.dropTable('notifications');
  },
};
