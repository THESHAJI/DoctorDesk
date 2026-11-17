const StatusBadge = ({ status }) => {
  const statusConfig = {
    booked: { label: 'Booked', className: 'badge-info' },
    completed: { label: 'Completed', className: 'badge-success' },
    cancelled: { label: 'Cancelled', className: 'badge-danger' },
    no_show: { label: 'No Show', className: 'badge-warning' },
    rescheduled: { label: 'Rescheduled', className: 'badge-secondary' },
    pending: { label: 'Pending', className: 'badge-warning' },
    approved: { label: 'Approved', className: 'badge-success' },
    rejected: { label: 'Rejected', className: 'badge-danger' },
    suspended: { label: 'Suspended', className: 'badge-danger' },
    available: { label: 'Available', className: 'badge-success' },
    blocked: { label: 'Blocked', className: 'badge-secondary' },
  };

  const config = statusConfig[status] || { label: status, className: 'badge-secondary' };

  return <span className={`badge ${config.className}`}>{config.label}</span>;
};

export default StatusBadge;
