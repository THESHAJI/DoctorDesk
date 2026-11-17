import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

// Pages
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import DoctorRegisterPage from './pages/auth/DoctorRegisterPage';
import PatientDashboard from './pages/patient/PatientDashboard';
import {
  NotificationsPage,
  PatientAppointmentsPage,
  PatientDoctorDetailsPage,
  PatientDoctorsPage,
  PatientPrescriptionsPage,
} from './pages/patient/PatientPages';
import DoctorDashboard from './pages/doctor/DoctorDashboard';
import {
  DoctorAppointmentsPage,
  DoctorAvailabilityPage,
  DoctorNotificationsPage,
  DoctorPrescriptionHistoryPage,
  DoctorProfilePage,
} from './pages/doctor/DoctorPages';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminUsersPage from './pages/admin/AdminUsersPage';
import AdminDoctorsPage from './pages/admin/AdminDoctorsPage';
import AdminAppointmentsPage from './pages/admin/AdminAppointmentsPage';
import AdminCommissionPage from './pages/admin/AdminCommissionPage';
import AdminBrandingPage from './pages/admin/AdminBrandingPage';

function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/register/doctor" element={<DoctorRegisterPage />} />

          {/* Patient Routes */}
          <Route path="/patient/dashboard" element={
            <ProtectedRoute allowedRoles={['patient']}>
              <PatientDashboard />
            </ProtectedRoute>
          } />
          <Route path="/patient/doctors" element={
            <ProtectedRoute allowedRoles={['patient']}><PatientDoctorsPage /></ProtectedRoute>
          } />
          <Route path="/patient/doctors/:id" element={
            <ProtectedRoute allowedRoles={['patient']}><PatientDoctorDetailsPage /></ProtectedRoute>
          } />
          <Route path="/patient/appointments" element={
            <ProtectedRoute allowedRoles={['patient']}><PatientAppointmentsPage /></ProtectedRoute>
          } />
          <Route path="/patient/prescriptions" element={
            <ProtectedRoute allowedRoles={['patient']}><PatientPrescriptionsPage /></ProtectedRoute>
          } />
          <Route path="/patient/notifications" element={
            <ProtectedRoute allowedRoles={['patient']}><NotificationsPage /></ProtectedRoute>
          } />

          {/* Doctor Routes */}
          <Route path="/doctor/dashboard" element={
            <ProtectedRoute allowedRoles={['doctor']}>
              <DoctorDashboard />
            </ProtectedRoute>
          } />
          <Route path="/doctor/profile" element={
            <ProtectedRoute allowedRoles={['doctor']}><DoctorProfilePage /></ProtectedRoute>
          } />
          <Route path="/doctor/certificates" element={
            <ProtectedRoute allowedRoles={['doctor']}><DoctorProfilePage /></ProtectedRoute>
          } />
          <Route path="/doctor/availability" element={
            <ProtectedRoute allowedRoles={['doctor']}><DoctorAvailabilityPage /></ProtectedRoute>
          } />
          <Route path="/doctor/appointments" element={
            <ProtectedRoute allowedRoles={['doctor']}><DoctorAppointmentsPage /></ProtectedRoute>
          } />
          <Route path="/doctor/prescriptions" element={
            <ProtectedRoute allowedRoles={['doctor']}><DoctorPrescriptionHistoryPage /></ProtectedRoute>
          } />
          <Route path="/doctor/notifications" element={
            <ProtectedRoute allowedRoles={['doctor']}><DoctorNotificationsPage /></ProtectedRoute>
          } />

          {/* Admin Routes */}
          <Route path="/admin/dashboard" element={
            <ProtectedRoute allowedRoles={['admin']}>
              <AdminDashboard />
            </ProtectedRoute>
          } />
          <Route path="/admin/users" element={
            <ProtectedRoute allowedRoles={['admin']}>
              <AdminUsersPage />
            </ProtectedRoute>
          } />
          <Route path="/admin/doctors" element={
            <ProtectedRoute allowedRoles={['admin']}>
              <AdminDoctorsPage />
            </ProtectedRoute>
          } />
          <Route path="/admin/appointments" element={
            <ProtectedRoute allowedRoles={['admin']}>
              <AdminAppointmentsPage />
            </ProtectedRoute>
          } />
          <Route path="/admin/settings/commission" element={
            <ProtectedRoute allowedRoles={['admin']}>
              <AdminCommissionPage />
            </ProtectedRoute>
          } />
          <Route path="/admin/settings/branding" element={
            <ProtectedRoute allowedRoles={['admin']}>
              <AdminBrandingPage />
            </ProtectedRoute>
          } />

          {/* Catch-all redirect */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </Router>
  );
}

export default App;
