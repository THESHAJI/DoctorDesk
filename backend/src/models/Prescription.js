const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class Prescription extends Model {}

  Prescription.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      appointment_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: { msg: 'Prescription already exists for this appointment' },
        references: {
          model: 'appointments',
          key: 'id',
        },
      },
      doctor_profile_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'doctor_profiles',
          key: 'id',
        },
      },
      patient_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
      },
      diagnosis: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'Prescription',
      tableName: 'prescriptions',
      underscored: true,
      timestamps: true,
    }
  );

  return Prescription;
};
