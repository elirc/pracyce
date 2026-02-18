import { useCallback, useEffect, useMemo, useState } from 'react';
import api from './lib/api';
import StatCard from './components/StatCard';

const INITIAL_FORM = {
  campaignName: '',
  subject: '',
  body: '',
  recipients: '',
  failRate: '0.25',
  maxAttempts: '4',
  backoffMs: '2000'
};

function parseRecipients(value) {
  // Accept multiple input styles so operators can paste from spreadsheets or email lists.
  return Array.from(
    new Set(
      value
        .split(/[\n,;\s]+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

function formatDate(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function App() {
  const [form, setForm] = useState(INITIAL_FORM);
  const [summary, setSummary] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [recentJobs, setRecentJobs] = useState([]);
  const [deadLetters, setDeadLetters] = useState([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [selectedCampaignJobs, setSelectedCampaignJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadCampaignJobs = useCallback(async (campaignId) => {
    if (!campaignId) {
      setSelectedCampaignJobs([]);
      return;
    }

    try {
      const response = await api.get(`/campaigns/${campaignId}/jobs`, {
        params: { pageSize: 20 }
      });
      setSelectedCampaignJobs(response.data.items);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Failed to load campaign jobs');
    }
  }, []);

  const loadDashboard = useCallback(async () => {
    try {
      // Fetch all dashboard panels together to keep each refresh snapshot internally consistent.
      const [summaryResponse, campaignsResponse, recentJobsResponse, deadLettersResponse] = await Promise.all([
        api.get('/dashboard/summary'),
        api.get('/campaigns', { params: { pageSize: 25 } }),
        api.get('/dashboard/recent-jobs', { params: { pageSize: 30 } }),
        api.get('/dashboard/dead-letters', { params: { pageSize: 20 } })
      ]);

      setSummary(summaryResponse.data);
      setCampaigns(campaignsResponse.data.items);
      setRecentJobs(recentJobsResponse.data.items);
      setDeadLetters(deadLettersResponse.data.items);

      if (!selectedCampaignId && campaignsResponse.data.items.length > 0) {
        setSelectedCampaignId(campaignsResponse.data.items[0].id);
      }
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, [selectedCampaignId]);

  useEffect(() => {
    // Polling keeps the operator view up to date without requiring websocket infrastructure.
    loadDashboard();
    const timer = setInterval(loadDashboard, 5000);

    return () => clearInterval(timer);
  }, [loadDashboard]);

  useEffect(() => {
    loadCampaignJobs(selectedCampaignId);
  }, [selectedCampaignId, loadCampaignJobs]);

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => campaign.id === selectedCampaignId) || null,
    [campaigns, selectedCampaignId]
  );

  async function handleCreateCampaign(event) {
    event.preventDefault();
    setError('');
    setNotice('');

    const recipients = parseRecipients(form.recipients);
    if (recipients.length === 0) {
      setError('At least one recipient email is required.');
      return;
    }

    setSubmitting(true);

    try {
      // Campaign creation fans out into N queue jobs on the backend.
      const response = await api.post('/campaigns', {
        campaignName: form.campaignName,
        subject: form.subject,
        body: form.body,
        recipients,
        failRate: Number(form.failRate),
        maxAttempts: Number(form.maxAttempts),
        backoffMs: Number(form.backoffMs)
      });

      setNotice(`Campaign queued: ${response.data.campaign.name} (${response.data.campaign.recipientCount} jobs)`);
      setForm(INITIAL_FORM);
      // After enqueue we refresh dashboard + focus the newly created campaign details.
      await loadDashboard();
      setSelectedCampaignId(response.data.campaign.id);
      await loadCampaignJobs(response.data.campaign.id);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Failed to create campaign');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRequeue(deadLetterId) {
    setError('');
    setNotice('');

    try {
      // Requeue resolves the dead-letter record and creates a brand new queue job id.
      await api.post(`/dashboard/dead-letters/${deadLetterId}/requeue`);
      setNotice('Dead-letter job requeued successfully.');
      await loadDashboard();
      await loadCampaignJobs(selectedCampaignId);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Failed to requeue dead-letter job');
    }
  }

  return (
    <div className="page">
      <header className="hero">
        <h1>Task Queue / Background Job System</h1>
        <p>
          Bulk email sender powered by BullMQ + Redis with retries, backoff, dead-letter queue handling, and monitoring.
        </p>
      </header>

      {error && <section className="alert error">{error}</section>}
      {notice && <section className="alert success">{notice}</section>}

      <section className="grid stats-grid">
        <StatCard title="Campaigns" value={summary?.campaigns ?? '-'} tone="default" />
        <StatCard title="Queued" value={summary?.jobs?.queued ?? '-'} tone="queue" />
        <StatCard title="Active" value={summary?.jobs?.active ?? '-'} tone="active" />
        <StatCard title="Retrying" value={summary?.jobs?.retrying ?? '-'} tone="retry" />
        <StatCard title="Completed" value={summary?.jobs?.completed ?? '-'} tone="done" />
        <StatCard title="Failed" value={summary?.jobs?.failed ?? '-'} tone="failed" />
        <StatCard title="DLQ Unresolved" value={summary?.deadLetters?.unresolved ?? '-'} tone="failed" />
      </section>

      <section className="panel">
        <h2>Create Campaign</h2>
        <form className="campaign-form" onSubmit={handleCreateCampaign}>
          <label>
            Campaign Name
            <input
              value={form.campaignName}
              onChange={(event) => setForm((prev) => ({ ...prev, campaignName: event.target.value }))}
              required
              minLength={3}
            />
          </label>

          <label>
            Subject
            <input
              value={form.subject}
              onChange={(event) => setForm((prev) => ({ ...prev, subject: event.target.value }))}
              required
              minLength={3}
            />
          </label>

          <label className="full-row">
            Body
            <textarea
              rows={4}
              value={form.body}
              onChange={(event) => setForm((prev) => ({ ...prev, body: event.target.value }))}
              required
              minLength={5}
            />
          </label>

          <label className="full-row">
            Recipients (one per line, comma, or space)
            <textarea
              rows={5}
              value={form.recipients}
              onChange={(event) => setForm((prev) => ({ ...prev, recipients: event.target.value }))}
              required
            />
          </label>

          <label>
            Failure Rate (0-1)
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={form.failRate}
              onChange={(event) => setForm((prev) => ({ ...prev, failRate: event.target.value }))}
            />
          </label>

          <label>
            Max Attempts
            <input
              type="number"
              min="1"
              max="10"
              step="1"
              value={form.maxAttempts}
              onChange={(event) => setForm((prev) => ({ ...prev, maxAttempts: event.target.value }))}
            />
          </label>

          <label>
            Initial Backoff (ms)
            <input
              type="number"
              min="250"
              max="60000"
              step="250"
              value={form.backoffMs}
              onChange={(event) => setForm((prev) => ({ ...prev, backoffMs: event.target.value }))}
            />
          </label>

          <div className="form-actions full-row">
            <button type="submit" disabled={submitting}>
              {submitting ? 'Queueing...' : 'Queue Campaign'}
            </button>
          </div>
        </form>
      </section>

      <section className="grid split-grid">
        <article className="panel">
          <h2>Campaigns</h2>
          {loading ? (
            <p>Loading campaigns...</p>
          ) : campaigns.length === 0 ? (
            <p>No campaigns yet.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Recipients</th>
                    <th>Queued</th>
                    <th>Active</th>
                    <th>Retrying</th>
                    <th>Completed</th>
                    <th>Failed</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((campaign) => (
                    <tr
                      key={campaign.id}
                      className={campaign.id === selectedCampaignId ? 'selected-row' : ''}
                      onClick={() => setSelectedCampaignId(campaign.id)}
                    >
                      <td>
                        <div className="row-title">{campaign.name}</div>
                        <small>{formatDate(campaign.created_at)}</small>
                      </td>
                      <td>{campaign.recipient_count}</td>
                      <td>{campaign.queued}</td>
                      <td>{campaign.active}</td>
                      <td>{campaign.retrying}</td>
                      <td>{campaign.completed}</td>
                      <td>{campaign.failed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        <article className="panel">
          <h2>Selected Campaign Jobs</h2>
          {selectedCampaign ? (
            <p className="subtitle">
              {selectedCampaign.name} ({selectedCampaign.id})
            </p>
          ) : (
            <p className="subtitle">Choose a campaign to inspect jobs.</p>
          )}

          {selectedCampaignJobs.length === 0 ? (
            <p>No jobs to display.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Recipient</th>
                    <th>Status</th>
                    <th>Attempts</th>
                    <th>Updated</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedCampaignJobs.map((job) => (
                    <tr key={job.queue_job_id}>
                      <td>{job.recipient_email}</td>
                      <td>
                        <span className={`badge badge-${job.status}`}>{job.status}</span>
                      </td>
                      <td>
                        {job.attempts_made}/{job.max_attempts}
                      </td>
                      <td>{formatDate(job.updated_at)}</td>
                      <td className="error-cell">{job.error_message || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </section>

      <section className="grid split-grid">
        <article className="panel">
          <h2>Dead Letter Queue</h2>
          {deadLetters.length === 0 ? (
            <p>No dead-letter jobs.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Recipient</th>
                    <th>Campaign</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {deadLetters.map((item) => (
                    <tr key={item.id}>
                      <td>{item.recipient_email}</td>
                      <td>{item.campaign_id}</td>
                      <td className="error-cell">{item.reason}</td>
                      <td>{item.resolved ? 'resolved' : 'unresolved'}</td>
                      <td>
                        <button disabled={item.resolved} onClick={() => handleRequeue(item.id)}>
                          Requeue
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        <article className="panel">
          <h2>Recent Jobs</h2>
          {recentJobs.length === 0 ? (
            <p>No jobs yet.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Queue Job ID</th>
                    <th>Recipient</th>
                    <th>Status</th>
                    <th>Attempts</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {recentJobs.map((job) => (
                    <tr key={job.queue_job_id}>
                      <td className="mono">{job.queue_job_id}</td>
                      <td>{job.recipient_email}</td>
                      <td>
                        <span className={`badge badge-${job.status}`}>{job.status}</span>
                      </td>
                      <td>
                        {job.attempts_made}/{job.max_attempts}
                      </td>
                      <td>{formatDate(job.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </section>

      <footer className="footer">
        Bull Board: <a href="http://localhost:4100/admin/queues">http://localhost:4100/admin/queues</a>
      </footer>
    </div>
  );
}

export default App;
