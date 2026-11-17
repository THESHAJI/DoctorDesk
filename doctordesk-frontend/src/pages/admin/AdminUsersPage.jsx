import { useState, useEffect, useCallback } from 'react';
import AdminLayout from '../../layouts/AdminLayout';
import adminService from '../../services/adminService';
import LoadingSpinner from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import StatusBadge from '../../components/StatusBadge';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useAuth } from '../../context/AuthContext';

const AdminUsersPage = () => {
  const { user: currentUser } = useAuth();

  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState({ totalItems: 0, totalPages: 1, currentPage: 1, limit: 10 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [page, setPage] = useState(1);

  // Confirmation dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const params = { page, limit: 10 };
      if (search.trim()) params.search = search.trim();
      if (roleFilter) params.role = roleFilter;
      if (activeFilter !== '') params.is_active = activeFilter;

      const response = await adminService.getUsers(params);
      const data = response.data.data;
      setUsers(data.users || []);
      setPagination(data.pagination || { totalItems: 0, totalPages: 1, currentPage: 1, limit: 10 });
    } catch (err) {
      setError(err.message || 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, [page, search, roleFilter, activeFilter]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Search with debounce via page reset
  const handleSearchChange = (e) => {
    setSearch(e.target.value);
    setPage(1);
  };

  const handleRoleChange = (e) => {
    setRoleFilter(e.target.value);
    setPage(1);
  };

  const handleActiveChange = (e) => {
    setActiveFilter(e.target.value);
    setPage(1);
  };

  // Status toggle
  const openConfirm = (user) => {
    setConfirmTarget(user);
    setConfirmOpen(true);
    setError('');
    setSuccessMsg('');
  };

  const handleStatusToggle = async () => {
    if (!confirmTarget) return;
    try {
      setActionLoading(true);
      setError('');
      const newStatus = !confirmTarget.is_active;
      await adminService.updateUserStatus(confirmTarget.id, newStatus);
      setSuccessMsg(`${confirmTarget.name} has been ${newStatus ? 'activated' : 'deactivated'} successfully.`);
      setConfirmOpen(false);
      setConfirmTarget(null);
      fetchUsers();
    } catch (err) {
      setError(err.message || 'Failed to update user status.');
      setConfirmOpen(false);
      setConfirmTarget(null);
    } finally {
      setActionLoading(false);
    }
  };

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  const isSelf = (userId) => currentUser && currentUser.id === userId;

  return (
    <AdminLayout>
      <div className="page-header">
        <h1>User Management</h1>
        <p>Search, filter, and manage platform user accounts.</p>
      </div>

      {/* Filter Bar */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ marginBottom: 0, flex: '1 1 220px' }}>
            <label>Search</label>
            <input
              type="text"
              placeholder="Name, email, or phone…"
              value={search}
              onChange={handleSearchChange}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0, flex: '0 0 150px' }}>
            <label>Role</label>
            <select value={roleFilter} onChange={handleRoleChange}>
              <option value="">All Roles</option>
              <option value="patient">Patient</option>
              <option value="doctor">Doctor</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0, flex: '0 0 150px' }}>
            <label>Status</label>
            <select value={activeFilter} onChange={handleActiveChange}>
              <option value="">All</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </div>
        </div>
      </div>

      {successMsg && <div className="alert alert-success">{successMsg}</div>}
      {error && <div className="alert alert-danger">{error}</div>}

      {loading ? (
        <LoadingSpinner message="Loading users…" />
      ) : users.length === 0 ? (
        <EmptyState icon="👥" title="No Users Found" message="No users match the current filters." />
      ) : (
        <>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Joined</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 500 }}>{u.name}</td>
                    <td>{u.email}</td>
                    <td>{u.phone || '—'}</td>
                    <td><span className="badge badge-info" style={{ textTransform: 'capitalize' }}>{u.role}</span></td>
                    <td>
                      <span className={`badge ${u.is_active ? 'badge-success' : 'badge-danger'}`}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(u.created_at)}</td>
                    <td>
                      {isSelf(u.id) ? (
                        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>You</span>
                      ) : (
                        <button
                          className={`btn btn-sm ${u.is_active ? 'btn-danger' : 'btn-success'}`}
                          onClick={() => openConfirm(u)}
                        >
                          {u.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      )}
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
                    <span key={`ellipsis-${idx}`} style={{ padding: '8px 4px', color: 'var(--text-muted)' }}>…</span>
                  ) : (
                    <button key={item} className={page === item ? 'active' : ''} onClick={() => setPage(item)}>{item}</button>
                  )
                )}
              <button disabled={page >= pagination.totalPages} onClick={() => setPage(page + 1)}>Next →</button>
            </div>
          )}
        </>
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={confirmOpen}
        title={confirmTarget?.is_active ? 'Deactivate User' : 'Activate User'}
        message={
          confirmTarget
            ? `Are you sure you want to ${confirmTarget.is_active ? 'deactivate' : 'activate'} ${confirmTarget.name} (${confirmTarget.email})? ${
                confirmTarget.is_active ? 'They will lose access to the platform.' : 'They will regain access.'
              }`
            : ''
        }
        confirmText={confirmTarget?.is_active ? 'Deactivate' : 'Activate'}
        variant={confirmTarget?.is_active ? 'danger' : 'success'}
        onConfirm={handleStatusToggle}
        onCancel={() => { setConfirmOpen(false); setConfirmTarget(null); }}
        loading={actionLoading}
      />
    </AdminLayout>
  );
};

export default AdminUsersPage;
