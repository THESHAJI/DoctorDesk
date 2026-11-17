const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class PrescriptionItem extends Model {}

  PrescriptionItem.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      prescription_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'prescriptions',
          key: 'id',
        },
      },
      medicine_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
          notEmpty: { msg: 'Medicine name is required' },
        },
      },
      dosage: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
          notEmpty: { msg: 'Dosage is required (e.g. 500mg)' },
        },
      },
      frequency: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
          notEmpty: { msg: 'Frequency is required (e.g. 1-0-1)' },
        },
      },
      duration: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
          notEmpty: { msg: 'Duration is required (e.g. 5 days)' },
        },
      },
      instructions: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'PrescriptionItem',
      tableName: 'prescription_items',
      underscored: true,
      timestamps: true,
    }
  );

  return PrescriptionItem;
};
