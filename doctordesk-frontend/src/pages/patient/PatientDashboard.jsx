import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PatientLayout from '../../layouts/PatientLayout';
import LoadingSpinner from '../../components/LoadingSpinner';
import api from '../../services/api';

const PatientDashboard = () => {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [appointments, prescriptions] = await Promise.all([
        api.get('/appointments/my', { params: { limit: 100 } }),
        api.get('/prescriptions/my', { params: { limit: 100 } }),
      ]);
      const items = appointments.data.data.appointments || [];
      setSummary({
        upcoming: items.filter((item) => item.status === 'booked').length,
        completed: items.filter((item) => item.status === 'completed').length,
        prescriptions: prescriptions.data.data.pagination?.total ?? prescriptions.data.data.prescriptions?.length ?? 0,
      });
    } catch (err) { setError(err.message || 'Could not load your dashboard.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <PatientLayout>
      <div className="page-header">
        <h1>Patient Dashboard</h1>
        <p>Welcome back! Here's your overview.</p>
      </div>
      {error && <div className="alert alert-danger">{error} <button className="btn btn-sm btn-secondary" onClick={load}>Retry</button></div>}
      {loading ? <LoadingSpinner message="Loading your dashboard…" /> : <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">📅</div>
          <div className="stat-info">
            <span className="stat-value">{summary?.upcoming ?? 0}</span>
            <span className="stat-label">Upcoming Appointments</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">✅</div>
          <div className="stat-info">
            <span className="stat-value">{summary?.completed ?? 0}</span>
            <span className="stat-label">Completed</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">💊</div>
          <div className="stat-info">
            <span className="stat-value">{summary?.prescriptions ?? 0}</span>
            <span className="stat-label">Prescriptions</span>
          </div>
        </div>
      </div>}
      <Link className="btn btn-primary" to="/patient/doctors">Find a doctor</Link>
    </PatientLayout>
  );
};

export default PatientDashboard;
