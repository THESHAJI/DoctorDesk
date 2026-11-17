import api from './api';

const authService = {
  registerPatient: (data) => api.post('/auth/register', data),
  registerDoctor: (data) => api.post('/auth/register/doctor', data),
  login: (data) => api.post('/auth/login', data),
  logout: () => api.post('/auth/logout', {}),
  getMe: () => api.get('/auth/me'),
};

export default authService;
