import { useEffect, useState } from 'react';
import api from '../lib/api';
import StatCard from '../components/StatCard';
import { STATUS_LABELS } from '../utils/status';

function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Guard prevents state writes after unmount during slow network responses.
    let isMounted = true;

    async function loadDashboard() {
      setLoading(true);
      setError('');
      try {
        // Fetch stats + recent list together so dashboard cards and list stay in sync.
        const [statsResponse, recentResponse] = await Promise.all([
          api.get('/dashboard/stats'),
          api.get('/applications', {
            params: {
              page: 1,
              page_size: 5,
              sort_by: 'updated_at',
              sort_order: 'desc'
            }
          })
        ]);

        if (!isMounted) return;
        setStats(statsResponse.data);
        setRecent(recentResponse.data.items);
      } catch (requestError) {
        if (!isMounted) return;
        setError(requestError.response?.data?.message || 'Failed to load dashboard');
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadDashboard();

    return () => {
      isMounted = false;
    };
  }, []);

  if (loading) {
    return <div className="panel">Loading dashboard...</div>;
  }

  if (error) {
    return <div className="panel error-text">{error}</div>;
  }

  return (
    <div className="dashboard">
      <section className="page-header">
        <h2>Dashboard</h2>
        <p>Monitor your funnel and keep your next move clear.</p>
      </section>

      <section className="stats-grid">
        <StatCard label="Total Applications" value={stats.total} accent="neutral" />
        <StatCard label="Active Pipeline" value={stats.active} accent="active" />
        <StatCard label="Interviews" value={stats.byStatus.interview} accent="interview" />
        <StatCard label="Offers" value={stats.byStatus.offer} accent="offer" />
        <StatCard label="Rejected" value={stats.byStatus.rejected} accent="rejected" />
        <StatCard label="Conversion Rate" value={`${stats.conversionRate}%`} accent="neutral" />
      </section>

      <section className="panel">
        <h3>Recent Updates</h3>
        {recent.length === 0 ? (
          <p>No applications yet.</p>
        ) : (
          <ul className="recent-list">
            {recent.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.company}</strong>
                  <span>{item.role}</span>
                </div>
                <span className={`pill status-${item.status}`}>{STATUS_LABELS[item.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default DashboardPage;
