module.exports = {
  ROLES: {
    PATIENT: 'patient',
    DOCTOR: 'doctor',
    ADMIN: 'admin',
  },

  DOCTOR_STATUS: {
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    SUSPENDED: 'suspended',
  },

  SLOT_STATUS: {
    AVAILABLE: 'available',
    BOOKED: 'booked',
    BLOCKED: 'blocked',
  },

  APPOINTMENT_STATUS: {
    BOOKED: 'booked',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
    NO_SHOW: 'no_show',
    RESCHEDULED: 'rescheduled',
  },

  RESCHEDULE_STATUS: {
    PENDING: 'pending',
    CONFIRMED: 'confirmed',
    REJECTED: 'rejected',
    EXPIRED: 'expired',
  },

  NOTIFICATION_TYPES: {
    BOOKING_CONFIRMATION: 'booking_confirmation',
    REMINDER_1DAY: 'reminder_1day',
    REMINDER_1HOUR: 'reminder_1hour',
    REMINDER_15MIN: 'reminder_15min',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
    RESCHEDULED: 'rescheduled',
    DOCTOR_APPROVED: 'doctor_approved',
    DOCTOR_REJECTED: 'doctor_rejected',
  },

  COMMISSION_TYPE: {
    PERCENTAGE: 'percentage',
    FIXED: 'fixed',
  },

  PAGINATION: {
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 10,
    MAX_LIMIT: 100,
  },

  FILE_UPLOAD: {
    CERTIFICATE_MAX_SIZE: 5 * 1024 * 1024, // 5MB
    LOGO_MAX_SIZE: 2 * 1024 * 1024, // 2MB
    ALLOWED_CERT_TYPES: ['image/jpeg', 'image/png', 'application/pdf'],
    ALLOWED_LOGO_TYPES: ['image/jpeg', 'image/png'],
  },

  SLOT_DURATION_MINUTES: 30,
  CANCEL_RESTRICTION_HOURS: 24,
};
