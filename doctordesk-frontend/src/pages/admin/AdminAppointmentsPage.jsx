import { useState, useEffect, useCallback } from 'react';
import AdminLayout from '../../layouts/AdminLayout';
import adminService from '../../services/adminService';
import LoadingSpinner from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import StatusBadge from '../../components/StatusBadge';

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'booked', label: 'Booked' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'rescheduled', label: 'Rescheduled' },
  { value: 'no_show', label: 'No Show' },
];

const AdminAppointmentsPage = () => {
  const [appointments, setAppointments] = useState([]);
  const [pagination, setPagination] = useState({ totalItems: 0, totalPages: 1, currentPage: 1, limit: 10 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [page, setPage] = useState(1);

  const fetchAppointments = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const params = { page, limit: 10 };
      if (statusFilter) params.status = statusFilter;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      if (createdFrom) params.createdFrom = createdFrom;
      if (createdTo) params.createdTo = createdTo;

      const response = await adminService.getAppointments(params);
      const data = response.data.data;
      setAppointments(data.appointments || []);
      setPagination(data.pagination || { totalItems: 0, totalPages: 1, currentPage: 1, limit: 10 });
    } catch (err) {
      setError(err.message || 'Failed to load appointments.');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, startDate, endDate, createdFrom, createdTo]);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  const handleFilterReset = () => {
    setStatusFilter('');
    setStartDate('');
    setEndDate('');
    setCreatedFrom('');
    setCreatedTo('');
    setPage(1);
  };

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const formatCurrency = (v) => v != null ? `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

  // Date range validation
  const dateRangeError = startDate && endDate && endDate < startDate;
  const createdRangeError = createdFrom && createdTo && createdTo < createdFrom;

  return (
    <AdminLayout>
      <div className="page-header">
        <h1>Appointment Monitoring</h1>
        <p>Track and inspect all platform appointments.</p>
      </div>

      {/* Filter Bar */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ marginBottom: 0, flex: '0 0 160px' }}>
            <label>Status</label>
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0, flex: '0 0 150px' }}>
            <label>Slot From</label>
            <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setPage(1); }} />
          </div>
          <div className="form-group" style={{ marginBottom: 0, flex: '0 0 150px' }}>
            <label>Slot To</label>
            <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setPage(1); }} />
          </div>
          <div className="form-group" style={{ marginBottom: 0, flex: '0 0 150px' }}>
            <label>Created From</label>
            <input type="date" value={createdFrom} onChange={(e) => { setCreatedFrom(e.target.value); setPage(1); }} />
          </div>
          <div className="form-group" style={{ marginBottom: 0, flex: '0 0 150px' }}>
            <label>Created To</label>
            <input type="date" value={createdTo} onChange={(e) => { setCreatedTo(e.target.value); setPage(1); }} />
          </div>
          <button className="btn btn-sm btn-secondary" onClick={handleFilterReset} style={{ marginBottom: '2px' }}>Reset</button>
        </div>
        {dateRangeError && <small style={{ color: 'var(--danger)', marginTop: '6px', display: 'block' }}>Slot "To" date must be on or after "From" date.</small>}
        {createdRangeError && <small style={{ color: 'var(--danger)', marginTop: '6px', display: 'block' }}>Created "To" date must be on or after "From" date.</small>}
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      {loading ? (
        <LoadingSpinner message="Loading appointments…" />
      ) : appointments.length === 0 ? (
        <EmptyState icon="📋" title="No Appointments" message="No appointments match the current filters." />
      ) : (
        <>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Doctor</th>
                  <th>Slot Date</th>
                  <th>Time</th>
                  <th>Status</th>
                  <th>Consult Fee</th>
                  <th>Commission</th>
                  <th>Doctor Payout</th>
                </tr>
              </thead>
              <tbody>
                {appointments.map((appt) => (
                  <tr key={appt.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{appt.patient?.name || '—'}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{appt.patient?.email || ''}</div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{appt.doctorProfile?.user?.name || '—'}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{appt.doctorProfile?.specialization || ''}</div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{appt.slot?.slot_date ? formatDate(appt.slot.slot_date + 'T00:00:00') : '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {appt.slot?.start_time && appt.slot?.end_time
                        ? `${appt.slot.start_time.slice(0, 5)} – ${appt.slot.end_time.slice(0, 5)}`
                        : '—'}
                    </td>
                    <td><StatusBadge status={appt.status} /></td>
                    <td>{formatCurrency(appt.consultation_fee)}</td>
                    <td>{formatCurrency(appt.commission_amount)}</td>
                    <td>{formatCurrency(appt.doctor_payout_amount ?? (Number(appt.consultation_fee) - Number(appt.commission_amount)))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="pagination">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
              {Array.from({ length: pagination.totalPages }, (_, i) => i + 1)
                .filter(p => Math.abs(p - page) <= 2 || p === 1 || p === pagination.totalPages)
                .reduce((acc, p, idx, arr) => {
                  if (idx > 0 && p - arr[idx - 1] > 1) acc.push('...');
                  acc.push(p);
                  return acc;
                }, [])
                .map((item, idx) =>
                  item === '...' ? (
                    <span key={`e-${idx}`} style={{ padding: '8px 4px', color: 'var(--text-muted)' }}>…</span>
                  ) : (
                    <button key={item} className={page === item ? 'active' : ''} onClick={() => setPage(item)}>{item}</button>
                  )
                )}
              <button disabled={page >= pagination.totalPages} onClick={() => setPage(page + 1)}>Next →</button>
            </div>
          )}
        </>
      )}
    </AdminLayout>
  );
};

export default AdminAppointmentsPage;
