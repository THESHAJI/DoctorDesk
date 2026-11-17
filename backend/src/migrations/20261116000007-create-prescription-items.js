'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('prescription_items', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      prescription_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'prescriptions',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      medicine_name: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      dosage: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      frequency: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      duration: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      instructions: {
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

    await queryInterface.addIndex('prescription_items', ['prescription_id'], {
      name: 'idx_prescription_items_prescription_id',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('prescription_items');
  },
};
