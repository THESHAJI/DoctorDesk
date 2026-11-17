const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class DoctorCertificate extends Model {}

  DoctorCertificate.init(
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
      file_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      original_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      file_path: {
        type: DataTypes.STRING(500),
        allowNull: false,
      },
      mime_type: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      file_size: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: 'DoctorCertificate',
      tableName: 'doctor_certificates',
      underscored: true,
      timestamps: true,
    }
  );

  return DoctorCertificate;
};
