const { Model, DataTypes } = require('sequelize');
const { RESCHEDULE_STATUS } = require('../config/constants');

module.exports = (sequelize) => {
  class RescheduleRequest extends Model {}

  RescheduleRequest.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      appointment_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'appointments',
          key: 'id',
        },
      },
      requested_by: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
      },
      suggested_slot_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'availability_slots',
          key: 'id',
        },
      },
      status: {
        type: DataTypes.ENUM(
          RESCHEDULE_STATUS.PENDING,
          RESCHEDULE_STATUS.CONFIRMED,
          RESCHEDULE_STATUS.REJECTED,
          RESCHEDULE_STATUS.EXPIRED
        ),
        allowNull: false,
        defaultValue: RESCHEDULE_STATUS.PENDING,
      },
      reason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      responded_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'RescheduleRequest',
      tableName: 'reschedule_requests',
      underscored: true,
      timestamps: true,
    }
  );

  return RescheduleRequest;
};
