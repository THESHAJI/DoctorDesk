import { useCallback, useEffect, useState } from 'react';
import DoctorLayout from '../../layouts/DoctorLayout';
import LoadingSpinner from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import StatusBadge from '../../components/StatusBadge';
import api from '../../services/api';
import { NotificationsPage } from '../patient/PatientPages';

const ErrorMessage = ({ message, onRetry }) => message && (
  <div className="alert alert-danger">
    {message} {onRetry && <button className="btn btn-sm btn-secondary" onClick={onRetry}>Retry</button>}
  </div>
);

const createEmptyPrescriptionItem = () => ({
  medicine_name: '',
  dosage: '',
  frequency: '',
  duration: '',
  instructions: '',
});

export const DoctorProfilePage = () => {
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({ specialization: '', qualification: '', consultationFee: '', bio: '' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const { data } = await api.get('/doctors/profile/me');
      const next = data.data.profile;
      setProfile(next);
      setForm({
        specialization: next.specialization || '',
        qualification: next.qualification || '',
        consultationFee: next.consultation_fee || '',
        bio: next.bio || '',
      });
    } catch (err) { setError(err.message || 'Could not load your profile.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (event) => {
    event.preventDefault();
    try {
      setBusy(true);
      setError('');
      const { data } = await api.put('/doctors/profile/me', form);
      setProfile(data.data.profile);
      setSuccess('Profile saved successfully.');
    } catch (err) { setError(err.message || 'Could not save your profile.'); }
    finally { setBusy(false); }
  };

  const upload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setBusy(true);
      setError('');
      const body = new FormData();
      body.append('certificate', file);
      await api.post('/doctors/certificates', body, { headers: { 'Content-Type': undefined } });
      setSuccess('Certificate uploaded.');
      await load();
    } catch (err) { setError(err.message || 'Could not upload certificate.'); }
    finally { setBusy(false); event.target.value = ''; }
  };

  const deleteCertificate = async (certificateId) => {
    if (!window.confirm('Delete this certificate?')) return;
    try {
      await api.delete(`/doctors/certificates/${certificateId}`, { data: {} });
      setSuccess('Certificate deleted.');
      await load();
    } catch (err) { setError(err.message || 'Could not delete certificate.'); }
  };

  return <DoctorLayout>
    <header className="page-header"><h1>Doctor Profile</h1><p>Keep your public profile and credentials up to date.</p></header>
    {loading ? <LoadingSpinner message="Loading profile…" /> : <>
      <ErrorMessage message={error} onRetry={load} />
      {success && <div className="alert alert-success">{success}</div>}
      {profile && <form className="card" onSubmit={save}>
        <p><strong>Approval status:</strong> <StatusBadge status={profile.status} /></p>
        <div className="form-group"><label>Specialization</label><input required value={form.specialization} onChange={(e) => setForm({ ...form, specialization: e.target.value })} /></div>
        <div className="form-group"><label>Qualification</label><input required value={form.qualification} onChange={(e) => setForm({ ...form, qualification: e.target.value })} /></div>
        <div className="form-group"><label>Consultation fee (₹)</label><input required type="number" min="0" step="0.01" value={form.consultationFee} onChange={(e) => setForm({ ...form, consultationFee: e.target.value })} /></div>
        <div className="form-group"><label>Bio</label><textarea rows="4" value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} /></div>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
      </form>}
      <section className="card" style={{ marginTop: 20 }}>
        <h2>Certificates</h2>
        <div className="form-group"><label htmlFor="certificate-upload">Upload PDF, JPEG, or PNG</label>
          <input id="certificate-upload" type="file" accept=".pdf,image/jpeg,image/png" onChange={upload} disabled={busy} /></div>
        {profile?.certificates?.length ? <ul>{profile.certificates.map((cert) => <li key={cert.id}>
          <a href={`/api/doctors/certificates/${cert.id}`}>{cert.original_name}</a> ({Math.ceil(cert.file_size / 1024)} KB){' '}
          <button type="button" className="btn btn-sm btn-danger" onClick={() => deleteCertificate(cert.id)}>Delete</button>
        </li>)}</ul> : <p>No certificates uploaded.</p>}
      </section>
    </>}
  </DoctorLayout>;
};

export const DoctorAvailabilityPage = () => {
  const [slots, setSlots] = useState([]);
  const [form, setForm] = useState({ slotDate: '', startTime: '', endTime: '' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const { data } = await api.get('/doctors/slots/me');
      setSlots(data.data.slots || []);
    } catch (err) { setError(err.message || 'Could not load availability.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const createSlot = async (event) => {
    event.preventDefault();
    try {
      setBusy(true);
      setError('');
      await api.post('/doctors/slots', form);
      setSuccess('Availability slot created.');
      setForm({ slotDate: '', startTime: '', endTime: '' });
      await load();
    } catch (err) { setError(err.message || 'Could not create slot.'); }
    finally { setBusy(false); }
  };
  const mutateSlot = async (slot, operation) => {
    try {
      setError('');
      if (operation === 'delete') await api.delete(`/doctors/slots/${slot.id}`, { data: {} });
      else await api.patch(`/doctors/slots/${slot.id}/${operation}`, {});
      const actionLabel = { block: 'blocked', unblock: 'unblocked', delete: 'deleted' }[operation];
      setSuccess(`Slot ${actionLabel}.`);
      await load();
    } catch (err) { setError(err.message || 'Could not update slot.'); }
  };

  return <DoctorLayout>
    <header className="page-header"><h1>Availability</h1><p>Create and manage consultation slots.</p></header>
    {error && <ErrorMessage message={error} onRetry={load} />}
    {success && <div className="alert alert-success">{success}</div>}
    <form className="card" onSubmit={createSlot}>
      <div className="form-row">
        <div className="form-group"><label>Date</label><input required type="date" value={form.slotDate} onChange={(e) => setForm({ ...form, slotDate: e.target.value })} /></div>
        <div className="form-group"><label>Start time</label><input required type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></div>
        <div className="form-group"><label>End time</label><input required type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} /></div>
      </div>
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create slot'}</button>
    </form>
    <h2 style={{ margin: '24px 0 12px' }}>Your slots</h2>
    {loading ? <LoadingSpinner message="Loading slots…" /> : slots.length === 0
      ? <EmptyState title="No availability" message="Create a slot to let patients book appointments." />
      : <div className="table-container"><table><thead><tr><th>Date</th><th>Time</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>{slots.map((slot) => <tr key={slot.id}><td>{slot.slot_date}</td><td>{slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}</td><td><StatusBadge status={slot.status} /></td>
          <td>{slot.status === 'available' && <><button className="btn btn-sm btn-secondary" onClick={() => mutateSlot(slot, 'block')}>Block</button>{' '}<button className="btn btn-sm btn-danger" onClick={() => mutateSlot(slot, 'delete')}>Delete</button></>}
            {slot.status === 'blocked' && <button className="btn btn-sm btn-secondary" onClick={() => mutateSlot(slot, 'unblock')}>Unblock</button>}</td></tr>)}</tbody></table></div>}
  </DoctorLayout>;
};

export const DoctorAppointmentsPage = () => {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [prescription, setPrescription] = useState({});

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const { data } = await api.get('/appointments/doctor', { params: { limit: 100 } });
      setAppointments(data.data.appointments || []);
    } catch (err) { setError(err.message || 'Could not load appointments.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const cancel = async (appointment) => {
    const reason = window.prompt('Please enter a cancellation reason (at least 5 characters):');
    if (reason === null) return;
    try {
      setBusyId(appointment.id);
      await api.patch(`/appointments/${appointment.id}/cancel`, { reason });
      setSuccess('Appointment cancelled and patient notified.');
      await load();
    } catch (err) { setError(err.message || 'Could not cancel appointment.'); }
    finally { setBusyId(null); }
  };

  const reschedule = async (appointment) => {
    const reason = window.prompt('Enter the reason for suggesting a new time:');
    if (reason === null) return;
    try {
      setBusyId(appointment.id);
      setError('');
      await api.post(`/appointments/${appointment.id}/doctor-reschedule`, { reason });
      setSuccess('Reschedule suggestion sent. The patient must confirm before the appointment changes.');
    } catch (err) { setError(err.message || 'Could not send a reschedule suggestion.'); }
    finally { setBusyId(null); }
  };

  const complete = async (appointment) => {
    try {
      setBusyId(appointment.id);
      setError('');
      await api.patch(`/appointments/${appointment.id}/complete`, {});
      setSuccess('Appointment completed. Create a prescription below.');
      await load();
    } catch (err) { setError(err.message || 'Could not complete appointment.'); }
    finally { setBusyId(null); }
  };

  const createPrescription = async (appointment) => {
    const form = prescription[appointment.id] || {
      diagnosis: '',
      items: [createEmptyPrescriptionItem()],
    };
    try {
      setBusyId(appointment.id);
      await api.post('/prescriptions', {
        appointmentId: appointment.id,
        diagnosis: form.diagnosis,
        items: form.items,
      });
      setSuccess(`Prescription created for appointment #${appointment.id}.`);
    } catch (err) { setError(err.message || 'Could not create prescription.'); }
    finally { setBusyId(null); }
  };

  const updatePrescription = (id, field, value, itemIndex) => setPrescription((current) => {
    const form = current[id] || { diagnosis: '', items: [createEmptyPrescriptionItem()] };
    if (field === 'diagnosis') {
      return { ...current, [id]: { ...form, diagnosis: value } };
    }
    return {
      ...current,
      [id]: {
        ...form,
        items: form.items.map((item, index) => (
          index === itemIndex ? { ...item, [field]: value } : item
        )),
      },
    };
  });

  const addPrescriptionItem = (id) => setPrescription((current) => {
    const form = current[id] || { diagnosis: '', items: [createEmptyPrescriptionItem()] };
    return { ...current, [id]: { ...form, items: [...form.items, createEmptyPrescriptionItem()] } };
  });

  const removePrescriptionItem = (id, itemIndex) => setPrescription((current) => {
    const form = current[id] || { diagnosis: '', items: [createEmptyPrescriptionItem()] };
    if (form.items.length <= 1) return current;
    return {
      ...current,
      [id]: { ...form, items: form.items.filter((_, index) => index !== itemIndex) },
    };
  });

  const renderPrescriptionForm = (appointment) => {
    const form = prescription[appointment.id] || {
      diagnosis: '',
      items: [createEmptyPrescriptionItem()],
    };

    return (
      <form className="card" style={{ marginTop: 16 }} onSubmit={(event) => {
        event.preventDefault();
        createPrescription(appointment);
      }}>
        <h3>Create prescription</h3>
        <div className="form-group">
          <label htmlFor={`diagnosis-${appointment.id}`}>Diagnosis</label>
          <input
            id={`diagnosis-${appointment.id}`}
            value={form.diagnosis}
            onChange={(e) => updatePrescription(appointment.id, 'diagnosis', e.target.value)}
          />
        </div>
        {form.items.map((item, itemIndex) => (
          <section key={itemIndex} className="card" style={{ marginBottom: 12 }}>
            <h4>Medicine {itemIndex + 1}</h4>
            {['medicine_name', 'dosage', 'frequency', 'duration', 'instructions'].map((field) => {
              const label = field.replace('_', ' ');
              const required = field !== 'instructions';
              const inputId = `prescription-${appointment.id}-${itemIndex}-${field}`;
              return (
                <div className="form-group" key={field}>
                  <label htmlFor={inputId}>{label}</label>
                  <input
                    id={inputId}
                    required={required}
                    value={item[field]}
                    onChange={(e) => updatePrescription(appointment.id, field, e.target.value, itemIndex)}
                  />
                </div>
              );
            })}
            {form.items.length > 1 && (
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => removePrescriptionItem(appointment.id, itemIndex)}
              >
                Remove medicine
              </button>
            )}
          </section>
        ))}
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => addPrescriptionItem(appointment.id)}
          style={{ marginBottom: 12 }}
        >
          Add medicine
        </button>
        <button className="btn btn-primary" disabled={busyId === appointment.id}>
          Save prescription
        </button>
      </form>
    );
  };

  return <DoctorLayout>
    <header className="page-header"><h1>Appointments</h1><p>Manage your schedule, complete visits, and create prescriptions.</p></header>
    {error && <ErrorMessage message={error} onRetry={load} />}
    {success && <div className="alert alert-success">{success}</div>}
    {loading ? <LoadingSpinner message="Loading appointments…" /> : appointments.length === 0
      ? <EmptyState title="No appointments" message="Patient bookings will appear here." />
      : appointments.map((appointment) => <article className="card" key={appointment.id} style={{ marginBottom: 16 }}>
        <h2>Appointment #{appointment.id} · {appointment.patient?.name}</h2>
        <p>{appointment.slot?.slot_date} · {appointment.slot?.start_time?.slice(0, 5)}–{appointment.slot?.end_time?.slice(0, 5)}</p>
        <p><StatusBadge status={appointment.status} /> · {appointment.patient?.email} · {appointment.patient?.phone}</p>
        {appointment.status === 'booked' && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button className="btn btn-success" onClick={() => complete(appointment)} disabled={busyId === appointment.id}>Complete visit</button>
          <button className="btn btn-danger" onClick={() => cancel(appointment)} disabled={busyId === appointment.id}>Cancel</button>
          <button className="btn btn-secondary" onClick={() => reschedule(appointment)} disabled={busyId === appointment.id}>Suggest new time</button>
        </div>}
        {appointment.status === 'completed' && renderPrescriptionForm(appointment)}
      </article>)}
  </DoctorLayout>;
};

export const DoctorPrescriptionHistoryPage = () => {
  const [prescriptions, setPrescriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const { data } = await api.get('/prescriptions/doctor', { params: { limit: 100 } });
      setPrescriptions(data.data.prescriptions || []);
    } catch (err) { setError(err.message || 'Could not load prescription history.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  return <DoctorLayout>
    <header className="page-header"><h1>Prescription History</h1><p>Prescriptions issued by you.</p></header>
    {error && <ErrorMessage message={error} onRetry={load} />}
    {loading ? <LoadingSpinner message="Loading prescription history…" /> : prescriptions.length === 0
      ? <EmptyState title="No prescriptions" message="Your issued prescriptions will appear here." />
      : <div className="table-container"><table><thead><tr><th>Patient</th><th>Diagnosis</th><th>Appointment</th><th>Date</th><th>Medicine</th></tr></thead>
        <tbody>{prescriptions.map((item) => <tr key={item.id}><td>{item.patient?.name}</td><td>{item.diagnosis || '—'}</td><td>#{item.appointment_id}</td><td>{item.created_at?.slice(0, 10)}</td><td>{item.items?.map((medicine) => medicine.medicine_name).join(', ') || '—'}</td></tr>)}</tbody></table></div>}
  </DoctorLayout>;
};

export const DoctorNotificationsPage = () => <NotificationsPage doctor />;
