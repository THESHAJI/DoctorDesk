import api from './api';

const adminService = {
  // Dashboard Metrics
  getDashboardStats: () => api.get('/admin/dashboard/stats'),

  // User Management
  getUsers: (params = {}) => api.get('/admin/users', { params }),
  updateUserStatus: (userId, isActive) =>
    api.patch(`/admin/users/${userId}/status`, { is_active: isActive }),

  // Doctor Approvals & Lifecycle
  getDoctorApplications: (params = {}) => api.get('/admin/doctors', { params }),
  getDoctorApplicationById: (id) => api.get(`/admin/doctors/${id}`),
  approveDoctor: (id) => api.patch(`/admin/doctors/${id}/approve`, {}),
  rejectDoctor: (id, reason) => api.patch(`/admin/doctors/${id}/reject`, { reason }),
  suspendDoctor: (id, reason) => api.patch(`/admin/doctors/${id}/suspend`, { reason }),

  // Appointments Monitoring
  getAppointments: (params = {}) => api.get('/admin/appointments', { params }),

  // Commission Settings
  getCommissionSettings: () => api.get('/admin/settings/commission'),
  updateCommissionSettings: (data) => api.put('/admin/settings/commission', data),

  // Branding Settings
  getBrandingSettings: () => api.get('/admin/settings/branding'),
  updateBrandingSettings: (data, isMultipart = false) =>
    api.put('/admin/settings/branding', data, isMultipart ? { headers: { 'Content-Type': undefined } } : {}),
};

export default adminService;
