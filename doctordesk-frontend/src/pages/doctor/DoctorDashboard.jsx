import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import DoctorLayout from '../../layouts/DoctorLayout';
import LoadingSpinner from '../../components/LoadingSpinner';
import api from '../../services/api';

const DoctorDashboard = () => {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [appointments, slots] = await Promise.all([
        api.get('/appointments/doctor', { params: { limit: 100 } }),
        api.get('/doctors/slots/me'),
      ]);
      const appointmentsList = appointments.data.data.appointments || [];
      const todayParts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date()).map((part) => [part.type, part.value]));
      const today = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;
      setSummary({
        today: appointmentsList.filter((item) => item.slot?.slot_date === today && item.status === 'booked').length,
        slots: (slots.data.data.slots || []).filter((slot) => slot.status === 'available').length,
        patients: new Set(appointmentsList.map((item) => item.patient?.id).filter(Boolean)).size,
      });
    } catch (err) { setError(err.message || 'Could not load your dashboard.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <DoctorLayout>
      <div className="page-header">
        <h1>Doctor Dashboard</h1>
        <p>Manage your appointments and availability.</p>
      </div>
      {error && <div className="alert alert-danger">{error} <button className="btn btn-sm btn-secondary" onClick={load}>Retry</button></div>}
      {loading ? <LoadingSpinner message="Loading your dashboard…" /> : <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">📅</div>
          <div className="stat-info">
            <span className="stat-value">{summary?.today ?? 0}</span>
            <span className="stat-label">Today's Appointments</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">⏰</div>
          <div className="stat-info">
            <span className="stat-value">{summary?.slots ?? 0}</span>
            <span className="stat-label">Available Slots</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">📋</div>
          <div className="stat-info">
            <span className="stat-value">{summary?.patients ?? 0}</span>
            <span className="stat-label">Total Patients</span>
          </div>
        </div>
      </div>}
      <Link className="btn btn-primary" to="/doctor/appointments">Manage appointments</Link>
    </DoctorLayout>
  );
};

export default DoctorDashboard;
