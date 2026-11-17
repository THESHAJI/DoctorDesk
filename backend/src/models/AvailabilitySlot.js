const { Model, DataTypes } = require('sequelize');
const { SLOT_STATUS } = require('../config/constants');

module.exports = (sequelize) => {
  class AvailabilitySlot extends Model {}

  AvailabilitySlot.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      doctor_profile_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'doctor_profiles',
          key: 'id',
        },
      },
      slot_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        validate: {
          isDate: { msg: 'Must be a valid date (YYYY-MM-DD)' },
        },
      },
      start_time: {
        type: DataTypes.TIME,
        allowNull: false,
      },
      end_time: {
        type: DataTypes.TIME,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM(
          SLOT_STATUS.AVAILABLE,
          SLOT_STATUS.BOOKED,
          SLOT_STATUS.BLOCKED
        ),
        allowNull: false,
        defaultValue: SLOT_STATUS.AVAILABLE,
      },
    },
    {
      sequelize,
      modelName: 'AvailabilitySlot',
      tableName: 'availability_slots',
      underscored: true,
      timestamps: true,
      validate: {
        endTimeAfterStartTime() {
          if (this.start_time && this.end_time && this.end_time <= this.start_time) {
            throw new Error('Slot end time must be later than start time');
          }
        },
      },
      indexes: [
        {
          unique: true,
          fields: ['doctor_profile_id', 'slot_date', 'start_time'],
          name: 'unique_doctor_slot_datetime',
        },
      ],
    }
  );

  return AvailabilitySlot;
};
