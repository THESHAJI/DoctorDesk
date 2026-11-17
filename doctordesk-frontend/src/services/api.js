import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Response interceptor for handling errors globally
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      const { status, data } = error.response;

      if (status === 401) {
        const currentPath = window.location.pathname;
        if (!currentPath.startsWith('/login') && !currentPath.startsWith('/register')) {
          window.location.href = '/login';
        }
      }

      return Promise.reject({
        status,
        message: data.message || 'Something went wrong',
        errors: data.errors || [],
      });
    }

    if (error.request) {
      return Promise.reject({
        status: 0,
        message: 'Network error. Please check your connection.',
        errors: [],
      });
    }

    return Promise.reject({
      status: 0,
      message: error.message,
      errors: [],
    });
  }
);

export default api;
