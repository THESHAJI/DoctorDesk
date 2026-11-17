import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import authService from '../../services/authService';
import AuthLayout from '../../layouts/AuthLayout';

const DoctorRegisterPage = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    name: '', email: '', phone: '', password: '', confirmPassword: '',
    specialization: '', qualification: '', consultationFee: '', bio: '',
  });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await authService.registerDoctor(formData);
      navigate('/login', { 
        state: { message: 'Registration successful! Your profile is pending admin approval.' } 
      });
    } catch (err) {
      setError(err.message);
      if (err.errors) setFieldErrors(err.errors);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <h2>Doctor Registration</h2>
      {error && <div className="alert alert-danger">{error}</div>}
      {fieldErrors.map((fe, i) => (
        <div key={i} className="alert alert-warning">{fe.field}: {fe.message}</div>
      ))}
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="name">Full Name</label>
            <input type="text" id="name" name="name" value={formData.name} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input type="email" id="email" name="email" value={formData.email} onChange={handleChange} required />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="phone">Phone</label>
            <input type="tel" id="phone" name="phone" value={formData.phone} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label htmlFor="specialization">Specialization</label>
            <input type="text" id="specialization" name="specialization" value={formData.specialization} onChange={handleChange} placeholder="e.g., Cardiologist" required />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="qualification">Qualification</label>
            <input type="text" id="qualification" name="qualification" value={formData.qualification} onChange={handleChange} placeholder="e.g., MBBS, MD" required />
          </div>
          <div className="form-group">
            <label htmlFor="consultationFee">Consultation Fee (₹)</label>
            <input type="number" id="consultationFee" name="consultationFee" value={formData.consultationFee} onChange={handleChange} min="0" step="0.01" required />
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="bio">Bio (optional)</label>
          <textarea id="bio" name="bio" value={formData.bio} onChange={handleChange} rows="3" placeholder="Brief description about yourself..." />
        </div>
        <div className="form-group">
          <label htmlFor="password">Password</label>
          <input type="password" id="password" name="password" value={formData.password} onChange={handleChange} required />
          <small>Min 8 chars, 1 uppercase, 1 number</small>
        </div>
        <div className="form-group">
          <label htmlFor="confirmPassword">Confirm Password</label>
          <input type="password" id="confirmPassword" name="confirmPassword" value={formData.confirmPassword} onChange={handleChange} required />
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
          {loading ? 'Registering...' : 'Register as Doctor'}
        </button>
      </form>
      <div className="auth-links">
        <p>Already have an account? <Link to="/login">Login</Link></p>
        <p>Not a doctor? <Link to="/register">Register as Patient</Link></p>
      </div>
    </AuthLayout>
  );
};

export default DoctorRegisterPage;
