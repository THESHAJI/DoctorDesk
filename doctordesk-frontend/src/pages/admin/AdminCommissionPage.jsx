import { useState, useEffect, useCallback } from 'react';
import AdminLayout from '../../layouts/AdminLayout';
import adminService from '../../services/adminService';
import LoadingSpinner from '../../components/LoadingSpinner';

const AdminCommissionPage = () => {
  const [commissionType, setCommissionType] = useState('percentage');
  const [commissionValue, setCommissionValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [validationError, setValidationError] = useState('');

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const response = await adminService.getCommissionSettings();
      const data = response.data.data;
      setCommissionType(data.commissionType || 'percentage');
      setCommissionValue(String(data.commissionValue ?? '10'));
    } catch (err) {
      setError(err.message || 'Failed to load commission settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const validate = () => {
    const val = parseFloat(commissionValue);
    if (isNaN(val) || val < 0) {
      setValidationError('Commission value must be a non-negative number.');
      return false;
    }
    if (commissionType === 'percentage' && val > 100) {
      setValidationError('Percentage commission cannot exceed 100%.');
      return false;
    }
    setValidationError('');
    return true;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    try {
      setSaving(true);
      setError('');
      setSuccessMsg('');
      await adminService.updateCommissionSettings({
        commissionType,
        commissionValue: parseFloat(commissionValue),
      });
      setSuccessMsg('Commission settings updated successfully.');
    } catch (err) {
      setError(err.message || 'Failed to update commission settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout>
      <div className="page-header">
        <h1>Commission Settings</h1>
        <p>Configure platform commission applied to new appointments.</p>
      </div>

      <div className="alert alert-info">
        <strong>Note:</strong> Changing the commission settings only affects <em>future</em> appointments.
        All existing appointment fee snapshots (consultation fee, commission amount, doctor payout) remain unchanged.
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {successMsg && <div className="alert alert-success">{successMsg}</div>}

      {loading ? (
        <LoadingSpinner message="Loading commission settings…" />
      ) : (
        <div className="card" style={{ maxWidth: '500px' }}>
          <form onSubmit={handleSave}>
            <div className="form-group">
              <label>Commission Type</label>
              <select
                value={commissionType}
                onChange={(e) => {
                  setCommissionType(e.target.value);
                  setValidationError('');
                  setSuccessMsg('');
                }}
              >
                <option value="percentage">Percentage (%)</option>
                <option value="fixed">Fixed Amount (₹)</option>
              </select>
            </div>

            <div className="form-group">
              <label>
                Commission Value {commissionType === 'percentage' ? '(%)' : '(₹)'}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                max={commissionType === 'percentage' ? '100' : undefined}
                value={commissionValue}
                onChange={(e) => {
                  setCommissionValue(e.target.value);
                  setValidationError('');
                  setSuccessMsg('');
                }}
                placeholder={commissionType === 'percentage' ? 'e.g. 10' : 'e.g. 50'}
              />
              {validationError && <small style={{ color: 'var(--danger)' }}>{validationError}</small>}
              <small>
                {commissionType === 'percentage'
                  ? 'Percentage of the consultation fee deducted as platform commission (0–100).'
                  : 'Fixed amount deducted from each consultation fee as platform commission.'}
              </small>
            </div>

            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save Commission Settings'}
            </button>
          </form>
        </div>
      )}
    </AdminLayout>
  );
};

export default AdminCommissionPage;
