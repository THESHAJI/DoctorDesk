'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Add suspension_reason to doctor_profiles
    await queryInterface.addColumn('doctor_profiles', 'suspension_reason', {
      type: Sequelize.TEXT,
      allowNull: true,
    });

    // 2. Add reviewed_by (foreign key referencing users.id)
    await queryInterface.addColumn('doctor_profiles', 'reviewed_by', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    // 3. Add reviewed_at timestamp
    await queryInterface.addColumn('doctor_profiles', 'reviewed_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    // 4. Add index for reviewed_by to optimize admin audit queries
    await queryInterface.addIndex('doctor_profiles', ['reviewed_by'], {
      name: 'idx_doctor_profiles_reviewed_by',
    });
  },

  async down(queryInterface, Sequelize) {
    // Rollback operations in reverse order
    await queryInterface.removeIndex('doctor_profiles', 'idx_doctor_profiles_reviewed_by');
    await queryInterface.removeColumn('doctor_profiles', 'reviewed_at');
    await queryInterface.removeColumn('doctor_profiles', 'reviewed_by');
    await queryInterface.removeColumn('doctor_profiles', 'suspension_reason');
  },
};
