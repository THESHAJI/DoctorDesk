'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('doctor_profiles', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        unique: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      specialization: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      qualification: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      consultation_fee: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      bio: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM('pending', 'approved', 'rejected', 'suspended'),
        allowNull: false,
        defaultValue: 'pending',
      },
      approved_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      approved_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      rejection_reason: {
        type: Sequelize.TEXT,
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

    await queryInterface.addIndex('doctor_profiles', ['user_id'], {
      unique: true,
      name: 'idx_doctor_profiles_user_id_unique',
    });
    await queryInterface.addIndex('doctor_profiles', ['status'], {
      name: 'idx_doctor_profiles_status',
    });
    await queryInterface.addIndex('doctor_profiles', ['specialization'], {
      name: 'idx_doctor_profiles_specialization',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('doctor_profiles');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_doctor_profiles_status";');
  },
};
