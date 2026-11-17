const { Sequelize } = require('sequelize');
const config = require('../config/database');

const env = process.env.NODE_ENV || 'development';
const dbConfig = config[env];

const sequelize = new Sequelize(
  dbConfig.database,
  dbConfig.username,
  dbConfig.password,
  {
    host: dbConfig.host,
    port: dbConfig.port,
    dialect: dbConfig.dialect,
    logging: dbConfig.logging,
    define: dbConfig.define,
    pool: dbConfig.pool,
  }
);

const db = {};

db.Sequelize = Sequelize;
db.sequelize = sequelize;

// ========================
// IMPORT ALL MODELS
// ========================
db.User = require('./User')(sequelize);
db.DoctorProfile = require('./DoctorProfile')(sequelize);
db.DoctorCertificate = require('./DoctorCertificate')(sequelize);
db.AvailabilitySlot = require('./AvailabilitySlot')(sequelize);
db.Appointment = require('./Appointment')(sequelize);
db.Prescription = require('./Prescription')(sequelize);
db.PrescriptionItem = require('./PrescriptionItem')(sequelize);
db.Notification = require('./Notification')(sequelize);
db.RescheduleRequest = require('./RescheduleRequest')(sequelize);
db.AppSetting = require('./AppSetting')(sequelize);

// ========================
// DEFINE ASSOCIATIONS
// ========================

// 1. User <-> DoctorProfile (One-to-One)
db.User.hasOne(db.DoctorProfile, {
  foreignKey: 'user_id',
  as: 'doctorProfile',
  onDelete: 'CASCADE',
});
db.DoctorProfile.belongsTo(db.User, {
  foreignKey: 'user_id',
  as: 'user',
});

// Admin who approved DoctorProfile
db.User.hasMany(db.DoctorProfile, {
  foreignKey: 'approved_by',
  as: 'approvedDoctorProfiles',
});
db.DoctorProfile.belongsTo(db.User, {
  foreignKey: 'approved_by',
  as: 'approver',
});

// Admin who performed the latest review (approve/reject/suspend) on DoctorProfile
db.User.hasMany(db.DoctorProfile, {
  foreignKey: 'reviewed_by',
  as: 'reviewedDoctorProfiles',
});
db.DoctorProfile.belongsTo(db.User, {
  foreignKey: 'reviewed_by',
  as: 'reviewer',
});

// 2. DoctorProfile <-> DoctorCertificate (One-to-Many)
db.DoctorProfile.hasMany(db.DoctorCertificate, {
  foreignKey: 'doctor_profile_id',
  as: 'certificates',
  onDelete: 'CASCADE',
});
db.DoctorCertificate.belongsTo(db.DoctorProfile, {
  foreignKey: 'doctor_profile_id',
  as: 'doctorProfile',
});

// 3. DoctorProfile <-> AvailabilitySlot (One-to-Many)
db.DoctorProfile.hasMany(db.AvailabilitySlot, {
  foreignKey: 'doctor_profile_id',
  as: 'slots',
  onDelete: 'CASCADE',
});
db.AvailabilitySlot.belongsTo(db.DoctorProfile, {
  foreignKey: 'doctor_profile_id',
  as: 'doctorProfile',
});

// 4. Appointments associations
// Patient (User) -> Appointments
db.User.hasMany(db.Appointment, {
  foreignKey: 'patient_id',
  as: 'patientAppointments',
  onDelete: 'CASCADE',
});
db.Appointment.belongsTo(db.User, {
  foreignKey: 'patient_id',
  as: 'patient',
});

// DoctorProfile -> Appointments
db.DoctorProfile.hasMany(db.Appointment, {
  foreignKey: 'doctor_profile_id',
  as: 'doctorAppointments',
  onDelete: 'CASCADE',
});
db.Appointment.belongsTo(db.DoctorProfile, {
  foreignKey: 'doctor_profile_id',
  as: 'doctorProfile',
});

// Slot -> Appointment (One active appointment per slot)
db.AvailabilitySlot.hasOne(db.Appointment, {
  foreignKey: 'slot_id',
  as: 'appointment',
});
db.Appointment.belongsTo(db.AvailabilitySlot, {
  foreignKey: 'slot_id',
  as: 'slot',
});

// 5. Prescriptions associations
// Appointment <-> Prescription (One-to-One)
db.Appointment.hasOne(db.Prescription, {
  foreignKey: 'appointment_id',
  as: 'prescription',
  onDelete: 'CASCADE',
});
db.Prescription.belongsTo(db.Appointment, {
  foreignKey: 'appointment_id',
  as: 'appointment',
});

// DoctorProfile -> Prescriptions
db.DoctorProfile.hasMany(db.Prescription, {
  foreignKey: 'doctor_profile_id',
  as: 'prescriptions',
});
db.Prescription.belongsTo(db.DoctorProfile, {
  foreignKey: 'doctor_profile_id',
  as: 'doctorProfile',
});

// Patient (User) -> Prescriptions
db.User.hasMany(db.Prescription, {
  foreignKey: 'patient_id',
  as: 'prescriptions',
});
db.Prescription.belongsTo(db.User, {
  foreignKey: 'patient_id',
  as: 'patient',
});

// Prescription <-> PrescriptionItem (One-to-Many)
db.Prescription.hasMany(db.PrescriptionItem, {
  foreignKey: 'prescription_id',
  as: 'items',
  onDelete: 'CASCADE',
});
db.PrescriptionItem.belongsTo(db.Prescription, {
  foreignKey: 'prescription_id',
  as: 'prescription',
});

// 6. Notifications associations
db.User.hasMany(db.Notification, {
  foreignKey: 'user_id',
  as: 'notifications',
  onDelete: 'CASCADE',
});
db.Notification.belongsTo(db.User, {
  foreignKey: 'user_id',
  as: 'user',
});

db.Appointment.hasMany(db.Notification, {
  foreignKey: 'appointment_id',
  as: 'notifications',
  onDelete: 'SET NULL',
});
db.Notification.belongsTo(db.Appointment, {
  foreignKey: 'appointment_id',
  as: 'appointment',
});

// 7. Reschedule Requests associations
db.Appointment.hasMany(db.RescheduleRequest, {
  foreignKey: 'appointment_id',
  as: 'rescheduleRequests',
  onDelete: 'CASCADE',
});
db.RescheduleRequest.belongsTo(db.Appointment, {
  foreignKey: 'appointment_id',
  as: 'appointment',
});

db.User.hasMany(db.RescheduleRequest, {
  foreignKey: 'requested_by',
  as: 'rescheduleRequests',
});
db.RescheduleRequest.belongsTo(db.User, {
  foreignKey: 'requested_by',
  as: 'requester',
});

db.AvailabilitySlot.hasMany(db.RescheduleRequest, {
  foreignKey: 'suggested_slot_id',
  as: 'rescheduleSuggestions',
  onDelete: 'SET NULL',
});
db.RescheduleRequest.belongsTo(db.AvailabilitySlot, {
  foreignKey: 'suggested_slot_id',
  as: 'suggestedSlot',
});

module.exports = db;
