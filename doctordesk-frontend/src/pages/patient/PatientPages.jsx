import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PatientLayout from '../../layouts/PatientLayout';
import DoctorLayout from '../../layouts/DoctorLayout';
import LoadingSpinner from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import StatusBadge from '../../components/StatusBadge';
import api from '../../services/api';

const ErrorMessage = ({ message, onRetry }) => message && (
  <div className="alert alert-danger">
    {message} {onRetry && <button className="btn btn-sm btn-secondary" onClick={onRetry}>Retry</button>}
  </div>
);

export const PatientDoctorsPage = () => {
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const { data } = await api.get('/doctors', { params: search ? { search } : {} });
      setDoctors(data.data.doctors || []);
    } catch (err) {
      setError(err.message || 'Could not load approved doctors.');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  return (
    <PatientLayout>
      <header className="page-header"><h1>Find a Doctor</h1><p>Browse approved doctors and book an available consultation.</p></header>
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label htmlFor="doctor-search">Search by name</label>
          <input id="doctor-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Doctor name" />
        </div>
      </div>
      <ErrorMessage message={error} onRetry={load} />
      {loading ? <LoadingSpinner message="Loading approved doctors…" /> : doctors.length === 0
        ? <EmptyState icon="🩺" title="No doctors found" message="Try a different search or check back later." />
        : <div className="stats-grid">{doctors.map((doctor) => (
          <article className="card" key={doctor.id}>
            <h2>Dr. {doctor.user?.name || 'Doctor'}</h2>
            <p>{doctor.specialization}</p>
            <p>{doctor.qualification}</p>
            <p><strong>Consultation fee:</strong> ₹{Number(doctor.consultation_fee).toFixed(2)}</p>
            <Link className="btn btn-primary" to={`/patient/doctors/${doctor.id}`}>View availability</Link>
          </article>
        ))}</div>}
    </PatientLayout>
  );
};

export const PatientDoctorDetailsPage = () => {
  const { id } = useParams();
  const [doctor, setDoctor] = useState(null);
  const [slots, setSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [doctorResponse, slotsResponse] = await Promise.all([
        api.get(`/doctors/${id}`),
        api.get(`/doctors/${id}/slots`),
      ]);
      setDoctor(doctorResponse.data.data.doctor);
      setSlots(slotsResponse.data.data.slots || []);
    } catch (err) {
      setError(err.message || 'Could not load doctor details and availability.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const book = async () => {
    if (!selectedSlot) return;
    try {
      setBusy(true);
      setError('');
      const { data } = await api.post('/appointments', { slotId: Number(selectedSlot), doctorProfileId: Number(id) });
      setSuccess(`Appointment #${data.data.appointment.id} booked. Your confirmation is available in My Appointments.`);
      await load();
    } catch (err) {
      setError(err.message || 'Could not book this slot. It may have just been taken.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <PatientLayout>
      {loading ? <LoadingSpinner message="Loading doctor…" /> : <>
        <header className="page-header"><h1>{doctor ? `Dr. ${doctor.user?.name}` : 'Doctor details'}</h1></header>
        <ErrorMessage message={error} onRetry={load} />
        {success && <div className="alert alert-success">{success}</div>}
        {doctor && <section className="card">
          <p><strong>Specialization:</strong> {doctor.specialization}</p>
          <p><strong>Qualification:</strong> {doctor.qualification}</p>
          <p><strong>Consultation fee:</strong> ₹{Number(doctor.consultation_fee).toFixed(2)}</p>
          {doctor.bio && <p>{doctor.bio}</p>}
          <h2 style={{ marginTop: 20 }}>Available slots</h2>
          {slots.length === 0 ? <EmptyState title="No slots available" message="Please check again later." /> : (
            <>
              <div className="form-group">
                <label htmlFor="available-slot">Choose a slot</label>
                <select id="available-slot" value={selectedSlot} onChange={(event) => setSelectedSlot(event.target.value)}>
                  <option value="">Select a date and time</option>
                  {slots.map((slot) => <option key={slot.id} value={slot.id}>
                    {slot.slot_date} · {slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}
                  </option>)}
                </select>
              </div>
              <button className="btn btn-primary" onClick={book} disabled={!selectedSlot || busy}>
                {busy ? 'Booking…' : 'Book appointment'}
              </button>
            </>
          )}
        </section>}
      </>}
    </PatientLayout>
  );
};

export const PatientAppointmentsPage = () => {
  const [appointments, setAppointments] = useState([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const { data } = await api.get('/appointments/my', { params: { limit: 100, ...(status ? { status } : {}) } });
      setAppointments(data.data.appointments || []);
    } catch (err) {
      setError(err.message || 'Could not load your appointments.');
    } finally {
      setLoading(false);
    }
  }, [status]);
  useEffect(() => { load(); }, [load]);

  const cancel = async (appointment) => {
    if (!window.confirm('Cancel this appointment? The 24-hour cancellation rule will be checked by the server.')) return;
    try {
      setError('');
      await api.patch(`/appointments/${appointment.id}/cancel`, { reason: 'Cancelled by patient' });
      setSuccess('Appointment cancelled.');
      await load();
    } catch (err) { setError(err.message || 'Could not cancel this appointment.'); }
  };

  const requestReschedule = async (appointment) => {
    try {
      setError('');
      const response = await api.post(`/appointments/${appointment.id}/reschedule`, { reason: 'Patient requested a new time' });
      const suggestion = response.data.data?.suggestedSlot;
      if (!suggestion) {
        setSuccess('Reschedule request submitted. Check again for a suggested slot.');
      } else {
        const accept = window.confirm(`Suggested time: ${suggestion.slot_date} ${suggestion.start_time}. Confirm this reschedule?`);
        if (accept) {
          await api.put(`/appointments/${appointment.id}/reschedule/confirm`, {});
          setSuccess('Appointment rescheduled successfully.');
          await load();
        } else {
          await api.put(`/appointments/${appointment.id}/reschedule/reject`, {});
          setSuccess('Suggestion declined. Your existing appointment remains unchanged.');
        }
      }
    } catch (err) { setError(err.message || 'Could not request a reschedule.'); }
  };

  const reviewSuggestion = async (appointment) => {
    try {
      setError('');
      const { data } = await api.get(`/appointments/${appointment.id}/reschedule/suggestion`);
      const slot = data.data.suggestedSlot;
      const accept = window.confirm(
        `Suggested appointment: ${slot?.slot_date} at ${slot?.start_time}. Confirm this change?`
      );
      if (accept) {
        await api.put(`/appointments/${appointment.id}/reschedule/confirm`, {});
        setSuccess('Appointment rescheduled successfully.');
        await load();
      } else {
        await api.put(`/appointments/${appointment.id}/reschedule/reject`, {});
        setSuccess('Suggestion declined. Your existing appointment remains unchanged.');
      }
    } catch (err) { setError(err.message || 'Could not load or respond to the suggestion.'); }
  };

  return (
    <PatientLayout>
      <header className="page-header"><h1>My Appointments</h1><p>Review upcoming visits and your appointment history.</p></header>
      <div className="form-group" style={{ maxWidth: 240 }}>
        <label htmlFor="appointment-status">Filter by status</label>
        <select id="appointment-status" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All appointments</option>
          {['booked', 'completed', 'cancelled', 'rescheduled', 'no_show'].map((value) => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}
        </select>
      </div>
      {error && <ErrorMessage message={error} onRetry={load} />}
      {success && <div className="alert alert-success">{success}</div>}
      {loading ? <LoadingSpinner message="Loading appointments…" /> : appointments.length === 0
        ? <EmptyState icon="📋" title="No appointments" message="Appointments you book will appear here." />
        : <div className="table-container"><table><thead><tr><th>Doctor</th><th>Date and time</th><th>Status</th><th>Fee</th><th>Actions</th></tr></thead>
          <tbody>{appointments.map((appointment) => <tr key={appointment.id}>
            <td>Dr. {appointment.doctor?.name || '—'}<br /><small>{appointment.doctor?.specialization}</small></td>
            <td>{appointment.slot?.slot_date} · {appointment.slot?.start_time?.slice(0, 5)}</td>
            <td><StatusBadge status={appointment.status} /></td>
            <td>₹{Number(appointment.consultation_fee).toFixed(2)}</td>
            <td>{appointment.status === 'booked' && <>
              <button className="btn btn-sm btn-secondary" onClick={() => cancel(appointment)}>Cancel</button>{' '}
              <button className="btn btn-sm btn-secondary" onClick={() => requestReschedule(appointment)}>Request reschedule</button>{' '}
              <button className="btn btn-sm btn-secondary" onClick={() => reviewSuggestion(appointment)}>Review suggestion</button>
            </>}</td>
          </tr>)}</tbody></table></div>}
    </PatientLayout>
  );
};

export const PatientPrescriptionsPage = () => {
  const [prescriptions, setPrescriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const { data } = await api.get('/prescriptions/my');
      setPrescriptions(data.data.prescriptions || []);
    } catch (err) { setError(err.message || 'Could not load prescriptions.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return <PatientLayout>
    <header className="page-header"><h1>Prescriptions</h1><p>Your prescriptions from completed appointments.</p></header>
    {error && <ErrorMessage message={error} onRetry={load} />}
    {loading ? <LoadingSpinner message="Loading prescriptions…" /> : prescriptions.length === 0
      ? <EmptyState icon="💊" title="No prescriptions yet" message="Prescriptions from your doctor will appear here." />
      : prescriptions.map((prescription) => <article className="card" key={prescription.id} style={{ marginBottom: 16 }}>
        <h2>{prescription.diagnosis || 'Prescription'} · {prescription.created_at?.slice(0, 10)}</h2>
        <p>Dr. {prescription.doctor?.name || '—'} · Appointment #{prescription.appointment_id}</p>
        {prescription.notes && <p>{prescription.notes}</p>}
        <ul>{prescription.items?.map((item) => <li key={item.id}>
          <strong>{item.medicine_name}</strong> — {item.dosage}, {item.frequency}, {item.duration}
          {item.instructions && ` · ${item.instructions}`}
        </li>)}</ul>
      </article>)}
  </PatientLayout>;
};

export const NotificationsPage = ({ doctor = false }) => {
  const Layout = doctor ? DoctorLayout : PatientLayout;
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const { data } = await api.get('/notifications', { params: { limit: 100 } });
      setNotifications(data.data.notifications || []);
    } catch (err) { setError(err.message || 'Could not load notifications.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const markRead = async (id) => {
    try {
      await api.patch(`/notifications/${id}/read`, {});
      setNotifications((current) => current.map((item) => item.id === id ? { ...item, is_read: true } : item));
    } catch (err) { setError(err.message || 'Could not update notification status.'); }
  };
  const markAllRead = async () => {
    try {
      await api.patch('/notifications/read-all', {});
      setNotifications((current) => current.map((item) => ({ ...item, is_read: true })));
      setSuccess('All notifications marked as read.');
    } catch (err) { setError(err.message || 'Could not mark notifications as read.'); }
  };

  return <Layout>
    <header className="page-header" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <div><h1>Notifications</h1><p>Appointment updates and reminders.</p></div>
      <button className="btn btn-secondary btn-sm" onClick={markAllRead}>Mark all read</button>
    </header>
    {error && <ErrorMessage message={error} onRetry={load} />}
    {success && <div className="alert alert-success">{success}</div>}
    {loading ? <LoadingSpinner message="Loading notifications…" /> : notifications.length === 0
      ? <EmptyState icon="🔔" title="No notifications" message="Updates will appear here." />
      : notifications.map((item) => <article className="card" key={item.id} style={{ marginBottom: 12, opacity: item.is_read ? 0.75 : 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div><h2>{item.title}</h2><p>{item.message}</p><small><strong>{item.is_read ? 'Read' : 'Unread'}</strong> · {item.sent_at && !Number.isNaN(new Date(item.sent_at).getTime()) ? new Date(item.sent_at).toLocaleString() : 'Time unavailable'}</small></div>
          {!item.is_read && <button className="btn btn-sm btn-secondary" onClick={() => markRead(item.id)}>Mark read</button>}
        </div>
      </article>)}
  </Layout>;
};
