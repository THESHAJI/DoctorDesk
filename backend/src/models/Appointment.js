const { Model, DataTypes } = require('sequelize');
const { APPOINTMENT_STATUS, COMMISSION_TYPE } = require('../config/constants');

module.exports = (sequelize) => {
  class Appointment extends Model {}

  Appointment.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      patient_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
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
      slot_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'availability_slots',
          key: 'id',
        },
      },
      status: {
        type: DataTypes.ENUM(
          APPOINTMENT_STATUS.BOOKED,
          APPOINTMENT_STATUS.COMPLETED,
          APPOINTMENT_STATUS.CANCELLED,
          APPOINTMENT_STATUS.NO_SHOW,
          APPOINTMENT_STATUS.RESCHEDULED
        ),
        allowNull: false,
        defaultValue: APPOINTMENT_STATUS.BOOKED,
      },
      consultation_fee: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      commission_amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      total_fee: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      commission_type: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: COMMISSION_TYPE.PERCENTAGE,
      },
      commission_value: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      cancellation_reason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      booked_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      completed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      cancelled_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'Appointment',
      tableName: 'appointments',
      underscored: true,
      timestamps: true,
    }
  );

  return Appointment;
};
