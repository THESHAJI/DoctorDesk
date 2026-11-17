import { useState, useEffect, useCallback } from 'react';
import AdminLayout from '../../layouts/AdminLayout';
import adminService from '../../services/adminService';
import LoadingSpinner from '../../components/LoadingSpinner';

const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB

const AdminBrandingPage = () => {
  const [appName, setAppName] = useState('');
  const [currentLogo, setCurrentLogo] = useState('');
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState('');
  const [removeLogo, setRemoveLogo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [fileError, setFileError] = useState('');

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const response = await adminService.getBrandingSettings();
      const data = response.data.data;
      setAppName(data.appName || '');
      setCurrentLogo(data.appLogo || '');
    } catch (err) {
      setError(err.message || 'Failed to load branding settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // Clean up preview URL on unmount or change
  useEffect(() => {
    return () => {
      if (logoPreview) URL.revokeObjectURL(logoPreview);
    };
  }, [logoPreview]);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    setFileError('');
    setSuccessMsg('');

    if (!file) {
      setLogoFile(null);
      setLogoPreview('');
      return;
    }

    // Validate type
    const allowedTypes = ['image/png', 'image/jpeg'];
    if (!allowedTypes.includes(file.type)) {
      setFileError('Only PNG and JPEG files are allowed.');
      e.target.value = '';
      return;
    }

    // Validate size
    if (file.size > MAX_LOGO_BYTES) {
      setFileError('File exceeds the 2 MB size limit.');
      e.target.value = '';
      return;
    }

    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
    setRemoveLogo(false);
  };

  const handleRemoveToggle = () => {
    setRemoveLogo(!removeLogo);
    if (!removeLogo) {
      setLogoFile(null);
      setLogoPreview('');
      setFileError('');
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      setError('');
      setSuccessMsg('');

      if (logoFile) {
        // Multipart upload
        const formData = new FormData();
        formData.append('appName', appName.trim());
        formData.append('logo', logoFile);
        await adminService.updateBrandingSettings(formData, true);
      } else {
        // JSON body
        const body = { appName: appName.trim() };
        if (removeLogo) body.removeLogo = true;
        await adminService.updateBrandingSettings(body, false);
      }

      setSuccessMsg('Branding settings updated successfully.');
      setLogoFile(null);
      setLogoPreview('');
      setRemoveLogo(false);
      // Reload settings to get fresh logo state
      fetchSettings();
    } catch (err) {
      setError(err.message || 'Failed to update branding settings.');
    } finally {
      setSaving(false);
    }
  };

  const logoSrc = removeLogo
    ? null
    : logoPreview || (currentLogo ? `/api/admin/settings/branding/logo?t=${Date.now()}` : null);

  return (
    <AdminLayout>
      <div className="page-header">
        <h1>Branding Settings</h1>
        <p>Customize the platform name and logo.</p>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {successMsg && <div className="alert alert-success">{successMsg}</div>}

      {loading ? (
        <LoadingSpinner message="Loading branding settings…" />
      ) : (
        <div className="card" style={{ maxWidth: '540px' }}>
          <form onSubmit={handleSave}>
            {/* App Name */}
            <div className="form-group">
              <label>Application Name</label>
              <input
                type="text"
                value={appName}
                onChange={(e) => { setAppName(e.target.value); setSuccessMsg(''); }}
                placeholder="DoctorDesk"
                maxLength={100}
              />
              <small>Displayed in the navigation bar and page titles.</small>
            </div>

            {/* Logo Preview */}
            <div className="form-group">
              <label>Logo Preview</label>
              <div style={{
                width: '100%',
                minHeight: '100px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '2px dashed var(--border)',
                borderRadius: 'var(--radius)',
                padding: '16px',
                background: 'var(--bg)',
                marginBottom: '8px',
              }}>
                {logoSrc ? (
                  <img
                    src={logoSrc}
                    alt="Logo preview"
                    style={{ maxWidth: '200px', maxHeight: '120px', objectFit: 'contain' }}
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                ) : (
                  <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>No custom logo</span>
                )}
              </div>
            </div>

            {/* File Upload */}
            <div className="form-group">
              <label>Upload New Logo</label>
              <input
                type="file"
                accept=".png,.jpg,.jpeg"
                onChange={handleFileChange}
                disabled={removeLogo}
              />
              {fileError && <small style={{ color: 'var(--danger)' }}>{fileError}</small>}
              <small>PNG or JPEG, max 2 MB.</small>
            </div>

            {/* Remove Logo */}
            {currentLogo && (
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 'normal' }}>
                  <input
                    type="checkbox"
                    checked={removeLogo}
                    onChange={handleRemoveToggle}
                    style={{ width: 'auto' }}
                  />
                  Remove current custom logo
                </label>
              </div>
            )}

            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save Branding Settings'}
            </button>
          </form>
        </div>
      )}
    </AdminLayout>
  );
};

export default AdminBrandingPage;
