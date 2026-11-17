import DashboardLayout from './DashboardLayout';

const adminMenuItems = [
  { path: '/admin/dashboard', label: 'Dashboard', icon: '📊' },
  { path: '/admin/doctors', label: 'Doctor Approvals', icon: '🩺' },
  { path: '/admin/users', label: 'Users', icon: '👥' },
  { path: '/admin/appointments', label: 'Appointments', icon: '📋' },
  { path: '/admin/settings/commission', label: 'Commission', icon: '💰' },
  { path: '/admin/settings/branding', label: 'Branding', icon: '🎨' },
];

const AdminLayout = ({ children }) => {
  return (
    <DashboardLayout menuItems={adminMenuItems}>
      {children}
    </DashboardLayout>
  );
};

export default AdminLayout;
