'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();

    await queryInterface.bulkInsert('app_settings', [
      {
        key: 'commission_type',
        value: 'percentage',
        description: 'Type of admin commission: percentage or fixed',
        created_at: now,
        updated_at: now,
      },
      {
        key: 'commission_value',
        value: '10',
        description: 'Commission value (percentage rate or fixed amount in INR)',
        created_at: now,
        updated_at: now,
      },
      {
        key: 'app_name',
        value: 'DoctorDesk',
        description: 'System branding application name',
        created_at: now,
        updated_at: now,
      },
      {
        key: 'app_logo',
        value: '',
        description: 'Uploaded brand logo filename or path',
        created_at: now,
        updated_at: now,
      },
    ]);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('app_settings', {
      key: ['commission_type', 'commission_value', 'app_name', 'app_logo'],
    });
  },
};
