const AuthLayout = ({ children }) => {
  return (
    <div className="auth-layout">
      <div className="auth-container">
        <div className="auth-brand">
          <h1>🏥 DoctorDesk</h1>
          <p>Doctor Appointment System</p>
        </div>
        <div className="auth-card">
          {children}
        </div>
      </div>
    </div>
  );
};

export default AuthLayout;
