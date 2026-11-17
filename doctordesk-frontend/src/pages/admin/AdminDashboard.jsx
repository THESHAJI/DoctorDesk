import { useState, useEffect, useCallback } from 'react';
import AdminLayout from '../../layouts/AdminLayout';
import adminService from '../../services/adminService';
import LoadingSpinner from '../../components/LoadingSpinner';

const AdminDashboard = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const response = await adminService.getDashboardStats();
      setStats(response.data.data);
    } catch (err) {
      setError(err.message || 'Failed to load dashboard statistics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const formatCurrency = (amount) =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2,
    }).format(amount || 0);

  return (
    <AdminLayout>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1>Admin Dashboard</h1>
          <p>System overview, operational metrics, and revenue analytics.</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={fetchStats} disabled={loading}>
          {loading ? 'Refreshing…' : '🔄 Refresh'}
        </button>
      </div>

      {error && (
        <div className="alert alert-danger">
          {error}
          <button className="btn btn-sm btn-secondary" onClick={fetchStats} style={{ marginLeft: 12 }}>Retry</button>
        </div>
      )}

      {loading && !stats ? (
        <LoadingSpinner message="Loading dashboard statistics…" />
      ) : stats ? (
        <>
          {/* Summary Cards */}
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-icon">👥</div>
              <div className="stat-info">
                <span className="stat-value">{stats.users?.total ?? 0}</span>
                <span className="stat-label">Total Users</span>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">🩺</div>
              <div className="stat-info">
                <span className="stat-value">{stats.doctors?.total ?? 0}</span>
                <span className="stat-label">Doctor Profiles</span>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">📋</div>
              <div className="stat-info">
                <span className="stat-value">{stats.appointments?.total ?? 0}</span>
                <span className="stat-label">Total Appointments</span>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">💰</div>
              <div className="stat-info">
                <span className="stat-value">{formatCurrency(stats.revenue?.total_commission_earned)}</span>
                <span className="stat-label">Platform Commission</span>
              </div>
            </div>
          </div>

          {/* Detailed Breakdown */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginBottom: '24px' }}>
            {/* User Distribution */}
            <div className="card">
              <div className="card-header"><h2 className="card-title">User Distribution</h2></div>
              <StatRow label="Patients" value={stats.users?.patients ?? 0} />
              <StatRow label="Doctors" value={stats.users?.doctors ?? 0} />
              <StatRow label="Admins" value={stats.users?.admins ?? 0} />
              <StatRow label="Active / Inactive" value={
                <><span style={{ color: 'var(--success)', fontWeight: 600 }}>{stats.users?.active ?? 0}</span>{' / '}<span style={{ color: 'var(--danger)', fontWeight: 600 }}>{stats.users?.inactive ?? 0}</span></>
              } last />
            </div>

            {/* Doctor Applications */}
            <div className="card">
              <div className="card-header"><h2 className="card-title">Doctor Applications</h2></div>
              <StatRow label="Pending Review" value={stats.doctors?.pending ?? 0} valueColor={stats.doctors?.pending > 0 ? 'var(--warning)' : undefined} />
              <StatRow label="Approved" value={stats.doctors?.approved ?? 0} valueColor="var(--success)" />
              <StatRow label="Rejected" value={stats.doctors?.rejected ?? 0} valueColor="var(--danger)" />
              <StatRow label="Suspended" value={stats.doctors?.suspended ?? 0} last />
            </div>

            {/* Appointment Lifecycle */}
            <div className="card">
              <div className="card-header"><h2 className="card-title">Appointment Status</h2></div>
              <StatRow label="Booked" value={stats.appointments?.booked ?? 0} valueColor="var(--primary)" />
              <StatRow label="Completed" value={stats.appointments?.completed ?? 0} valueColor="var(--success)" />
              <StatRow label="Cancelled" value={stats.appointments?.cancelled ?? 0} valueColor="var(--danger)" />
              <StatRow label="Rescheduled / No-Show" value={
                <><strong>{stats.appointments?.rescheduled ?? 0}</strong>{' / '}<strong>{stats.appointments?.no_show ?? 0}</strong></>
              } last />
            </div>

            {/* Financial Overview */}
            <div className="card">
              <div className="card-header"><h2 className="card-title">Completed Financials</h2></div>
              <StatRow label="Consultation Volume" value={formatCurrency(stats.revenue?.total_consultation_volume)} />
              <StatRow label="Platform Commission" value={formatCurrency(stats.revenue?.total_commission_earned)} valueColor="var(--primary)" />
              <StatRow label="Doctor Net Payout" value={formatCurrency(stats.revenue?.total_doctor_payout)} valueColor="var(--success)" last />
            </div>
          </div>
        </>
      ) : null}
    </AdminLayout>
  );
};

const StatRow = ({ label, value, valueColor, last }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: last ? 'none' : '1px solid var(--border)' }}>
    <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>{label}</span>
    <strong style={{ color: valueColor }}>{value}</strong>
  </div>
);

export default AdminDashboard;
