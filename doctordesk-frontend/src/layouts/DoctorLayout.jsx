import DashboardLayout from './DashboardLayout';

const doctorMenuItems = [
  { path: '/doctor/dashboard', label: 'Dashboard', icon: '🏠' },
  { path: '/doctor/profile', label: 'My Profile', icon: '👤' },
  { path: '/doctor/certificates', label: 'Certificates', icon: '📄' },
  { path: '/doctor/availability', label: 'Availability', icon: '📅' },
  { path: '/doctor/appointments', label: 'Appointments', icon: '📋' },
  { path: '/doctor/prescriptions', label: 'Prescriptions', icon: '💊' },
  { path: '/doctor/notifications', label: 'Notifications', icon: '🔔' },
];

const DoctorLayout = ({ children }) => {
  return (
    <DashboardLayout menuItems={doctorMenuItems}>
      {children}
    </DashboardLayout>
  );
};

export default DoctorLayout;
