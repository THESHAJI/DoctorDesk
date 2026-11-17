import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const LandingPage = () => {
  const { isAuthenticated, user } = useAuth();

  const dashboardRoutes = {
    patient: '/patient/dashboard',
    doctor: '/doctor/dashboard',
    admin: '/admin/dashboard',
  };

  return (
    <div className="landing-page">
      <header className="landing-header">
        <div className="landing-brand">🏥 DoctorDesk</div>
        <nav className="landing-nav">
          {isAuthenticated ? (
            <Link to={dashboardRoutes[user.role]} className="btn btn-primary">
              Go to Dashboard
            </Link>
          ) : (
            <>
              <Link to="/login" className="btn btn-secondary">Login</Link>
              <Link to="/register" className="btn btn-primary">Register</Link>
            </>
          )}
        </nav>
      </header>

      <main className="landing-hero">
        <h1>Book Doctor Appointments<br />with Ease</h1>
        <p>Find experienced doctors, book appointments, and manage your health — all in one place.</p>
        <div className="landing-cta">
          <Link to="/register" className="btn btn-primary btn-lg">Get Started as Patient</Link>
          <Link to="/register/doctor" className="btn btn-secondary btn-lg">Join as Doctor</Link>
        </div>
      </main>

      <section className="landing-features">
        <div className="feature-card">
          <span className="feature-icon">🔍</span>
          <h3>Find Doctors</h3>
          <p>Browse approved doctors by specialization</p>
        </div>
        <div className="feature-card">
          <span className="feature-icon">📅</span>
          <h3>Easy Booking</h3>
          <p>Book available slots with transparent pricing</p>
        </div>
        <div className="feature-card">
          <span className="feature-icon">💊</span>
          <h3>Prescriptions</h3>
          <p>Access your prescriptions anytime</p>
        </div>
      </section>

      <footer className="landing-footer">
        <p>© 2026 DoctorDesk. Doctor Appointment System.</p>
      </footer>
    </div>
  );
};

export default LandingPage;
