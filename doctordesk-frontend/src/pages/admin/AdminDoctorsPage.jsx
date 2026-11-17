import { useState, useEffect, useCallback } from 'react';
import AdminLayout from '../../layouts/AdminLayout';
import adminService from '../../services/adminService';
import LoadingSpinner from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import StatusBadge from '../../components/StatusBadge';
import ConfirmDialog from '../../components/ConfirmDialog';

const STATUS_TABS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'suspended', label: 'Suspended' },
];

const AdminDoctorsPage = () => {
  const [applications, setApplications] = useState([]);
  const [pagination, setPagination] = useState({ totalItems: 0, totalPages: 1, currentPage: 1, limit: 10 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Filter state
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  // Detail modal
  const [detailDoctor, setDetailDoctor] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Action dialogs
  const [confirmAction, setConfirmAction] = useState(null); // { type: 'approve'|'reject'|'suspend', doctor }
  const [actionLoading, setActionLoading] = useState(false);
  const [reasonText, setReasonText] = useState('');
  const [reasonError, setReasonError] = useState('');

  const fetchApplications = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const params = { page, limit: 10 };
      if (statusFilter) params.status = statusFilter;
      const response = await adminService.getDoctorApplications(params);
      const data = response.data.data;
      setApplications(data.applications || []);
      setPagination(data.pagination || { totalItems: 0, totalPages: 1, currentPage: 1, limit: 10 });
    } catch (err) {
      setError(err.message || 'Failed to load doctor applications.');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  const handleTabChange = (value) => {
    setStatusFilter(value);
    setPage(1);
  };

  // View detail
  const viewDetail = async (doctorProfileId) => {
    try {
      setDetailLoading(true);
      setError('');
      const response = await adminService.getDoctorApplicationById(doctorProfileId);
      setDetailDoctor(response.data.data.application);
    } catch (err) {
      setError(err.message || 'Failed to load doctor details.');
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => setDetailDoctor(null);

  // Actions
  const openAction = (type, doctor) => {
    setConfirmAction({ type, doctor });
    setReasonText('');
    setReasonError('');
    setError('');
    setSuccessMsg('');
  };

  const closeAction = () => {
    setConfirmAction(null);
    setReasonText('');
    setReasonError('');
  };

  const executeAction = async () => {
    if (!confirmAction) return;
    const { type, doctor } = confirmAction;

    if ((type === 'reject' || type === 'suspend') && !reasonText.trim()) {
      setReasonError('A reason is required.');
      return;
    }

    try {
      setActionLoading(true);
      setError('');
      if (type === 'approve') {
        await adminService.approveDoctor(doctor.id);
        setSuccessMsg(`Dr. ${doctor.user?.name || doctor.id} has been approved.`);
      } else if (type === 'reject') {
        await adminService.rejectDoctor(doctor.id, reasonText.trim());
        setSuccessMsg(`Dr. ${doctor.user?.name || doctor.id} has been rejected.`);
      } else if (type === 'suspend') {
        await adminService.suspendDoctor(doctor.id, reasonText.trim());
        setSuccessMsg(`Dr. ${doctor.user?.name || doctor.id} has been suspended.`);
      }
      closeAction();
      setDetailDoctor(null);
      fetchApplications();
    } catch (err) {
      setError(err.message || `Failed to ${type} doctor.`);
      closeAction();
    } finally {
      setActionLoading(false);
    }
  };

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  return (
    <AdminLayout>
      <div className="page-header">
        <h1>Doctor Approvals</h1>
        <p>Review and manage doctor applications and profiles.</p>
      </div>

      {/* Status Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            className={`btn btn-sm ${statusFilter === tab.value ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => handleTabChange(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {successMsg && <div className="alert alert-success">{successMsg}</div>}
      {error && <div className="alert alert-danger">{error}</div>}

      {loading ? (
        <LoadingSpinner message="Loading doctor applications…" />
      ) : applications.length === 0 ? (
        <EmptyState icon="🩺" title="No Applications" message="No doctor applications match the current filter." />
      ) : (
        <>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Doctor Name</th>
                  <th>Email</th>
                  <th>Specialization</th>
                  <th>Experience</th>
                  <th>Fee</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((app) => (
                  <tr key={app.id}>
                    <td style={{ fontWeight: 500 }}>{app.user?.name || '—'}</td>
                    <td>{app.user?.email || '—'}</td>
                    <td>{app.specialization || '—'}</td>
                    <td>{app.experience_years != null ? `${app.experience_years} yrs` : '—'}</td>
                    <td>{app.consultation_fee != null ? `₹${Number(app.consultation_fee).toLocaleString()}` : '—'}</td>
                    <td><StatusBadge status={app.status} /></td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <button className="btn btn-sm btn-secondary" onClick={() => viewDetail(app.id)}>View</button>
                        {app.status === 'pending' && (
                          <>
                            <button className="btn btn-sm btn-success" onClick={() => openAction('approve', app)}>Approve</button>
                            <button className="btn btn-sm btn-danger" onClick={() => openAction('reject', app)}>Reject</button>
                          </>
                        )}
                        {app.status === 'approved' && (
                          <button className="btn btn-sm btn-danger" onClick={() => openAction('suspend', app)}>Suspend</button>
                        )}
                      </div>
                    </td>
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

      {/* Detail Modal */}
      {(detailDoctor || detailLoading) && (
        <div className="dialog-overlay" onClick={closeDetail}>
          <div className="dialog-content" style={{ maxWidth: '600px', maxHeight: '80vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            {detailLoading ? (
              <LoadingSpinner message="Loading details…" />
            ) : detailDoctor ? (
              <>
                <h3 className="dialog-title">Doctor Application Details</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
                  <DetailRow label="Name" value={detailDoctor.user?.name} />
                  <DetailRow label="Email" value={detailDoctor.user?.email} />
                  <DetailRow label="Phone" value={detailDoctor.user?.phone || '—'} />
                  <DetailRow label="Specialization" value={detailDoctor.specialization} />
                  <DetailRow label="Qualification" value={detailDoctor.qualification} />
                  <DetailRow label="Experience" value={detailDoctor.experience_years != null ? `${detailDoctor.experience_years} years` : '—'} />
                  <DetailRow label="Consultation Fee" value={detailDoctor.consultation_fee != null ? `₹${Number(detailDoctor.consultation_fee).toLocaleString()}` : '—'} />
                  <DetailRow label="Status" value={<StatusBadge status={detailDoctor.status} />} />
                  {detailDoctor.bio && <DetailRow label="Bio" value={detailDoctor.bio} />}
                  {detailDoctor.rejection_reason && <DetailRow label="Rejection Reason" value={detailDoctor.rejection_reason} />}
                  {detailDoctor.suspension_reason && <DetailRow label="Suspension Reason" value={detailDoctor.suspension_reason} />}
                  <DetailRow label="Applied" value={formatDate(detailDoctor.created_at)} />
                  {detailDoctor.reviewed_at && <DetailRow label="Reviewed" value={formatDate(detailDoctor.reviewed_at)} />}
                </div>

                {/* Certificates */}
                {detailDoctor.certificates && detailDoctor.certificates.length > 0 && (
                  <div style={{ marginBottom: '20px' }}>
                    <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>Certificates ({detailDoctor.certificates.length})</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {detailDoctor.certificates.map((cert) => (
                        <div key={cert.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                          <span style={{ fontSize: '13px' }}>{cert.original_name}</span>
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{cert.mime_type}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Detail modal action buttons */}
                <div className="dialog-actions">
                  {detailDoctor.status === 'pending' && (
                    <>
                      <button className="btn btn-success btn-sm" onClick={() => { closeDetail(); openAction('approve', detailDoctor); }}>Approve</button>
                      <button className="btn btn-danger btn-sm" onClick={() => { closeDetail(); openAction('reject', detailDoctor); }}>Reject</button>
                    </>
                  )}
                  {detailDoctor.status === 'approved' && (
                    <button className="btn btn-danger btn-sm" onClick={() => { closeDetail(); openAction('suspend', detailDoctor); }}>Suspend</button>
                  )}
                  <button className="btn btn-secondary btn-sm" onClick={closeDetail}>Close</button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* Action Confirmation Dialog */}
      {confirmAction && confirmAction.type === 'approve' && (
        <ConfirmDialog
          isOpen
          title="Approve Doctor"
          message={`Are you sure you want to approve Dr. ${confirmAction.doctor.user?.name || confirmAction.doctor.id}? Their profile will become active.`}
          confirmText="Approve"
          variant="success"
          onConfirm={executeAction}
          onCancel={closeAction}
          loading={actionLoading}
        />
      )}

      {/* Reject / Suspend Dialog with reason input */}
      {confirmAction && (confirmAction.type === 'reject' || confirmAction.type === 'suspend') && (
        <div className="dialog-overlay" onClick={closeAction}>
          <div className="dialog-content" onClick={(e) => e.stopPropagation()}>
            <h3 className="dialog-title">
              {confirmAction.type === 'reject' ? 'Reject' : 'Suspend'} Doctor
            </h3>
            <p className="dialog-message">
              Provide a reason for {confirmAction.type === 'reject' ? 'rejecting' : 'suspending'} Dr. {confirmAction.doctor.user?.name || confirmAction.doctor.id}.
            </p>
            <div className="form-group">
              <label>Reason (required)</label>
              <textarea
                rows={3}
                value={reasonText}
                onChange={(e) => { setReasonText(e.target.value); setReasonError(''); }}
                placeholder={`Enter the reason for ${confirmAction.type}…`}
                style={{ resize: 'vertical' }}
              />
              {reasonError && <small style={{ color: 'var(--danger)' }}>{reasonError}</small>}
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={closeAction} disabled={actionLoading}>Cancel</button>
              <button className="btn btn-danger" onClick={executeAction} disabled={actionLoading}>
                {actionLoading ? 'Processing…' : confirmAction.type === 'reject' ? 'Reject' : 'Suspend'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
};

const DetailRow = ({ label, value }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
    <span style={{ color: 'var(--text-secondary)', fontSize: '13px', minWidth: '120px', flexShrink: 0 }}>{label}</span>
    <span style={{ fontSize: '14px', fontWeight: 500, textAlign: 'right', wordBreak: 'break-word' }}>{value || '—'}</span>
  </div>
);

export default AdminDoctorsPage;
