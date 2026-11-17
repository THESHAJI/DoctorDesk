import DashboardLayout from './DashboardLayout';

const patientMenuItems = [
  { path: '/patient/dashboard', label: 'Dashboard', icon: '🏠' },
  { path: '/patient/doctors', label: 'Find Doctors', icon: '🔍' },
  { path: '/patient/appointments', label: 'My Appointments', icon: '📋' },
  { path: '/patient/prescriptions', label: 'Prescriptions', icon: '💊' },
  { path: '/patient/notifications', label: 'Notifications', icon: '🔔' },
];

const PatientLayout = ({ children }) => {
  return (
    <DashboardLayout menuItems={patientMenuItems}>
      {children}
    </DashboardLayout>
  );
};

export default PatientLayout;
