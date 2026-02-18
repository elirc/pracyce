import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../lib/api';
import ApplicationFormModal from '../components/ApplicationFormModal';
import { formatCurrency, STATUS_LABELS, STATUS_OPTIONS, TRANSITIONS } from '../utils/status';

const SORT_OPTIONS = [
  { value: 'updated_at', label: 'Last Updated' },
  { value: 'created_at', label: 'Created At' },
  { value: 'applied_date', label: 'Applied Date' },
  { value: 'company', label: 'Company' },
  { value: 'role', label: 'Role' },
  { value: 'status', label: 'Status' }
];

function ApplicationsPage() {
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, total_pages: 1, page_size: 10 });
  const [filters, setFilters] = useState({
    search: '',
    status: '',
    sort_by: 'updated_at',
    sort_order: 'desc',
    page: 1,
    page_size: 10
  });
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);

  useEffect(() => {
    // Keep input responsive while reducing API chatter during fast typing.
    const timeoutId = setTimeout(() => {
      setFilters((prev) => ({
        ...prev,
        search: searchInput,
        page: 1
      }));
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchInput]);

  const apiParams = useMemo(() => {
    const params = {
      page: filters.page,
      page_size: filters.page_size,
      sort_by: filters.sort_by,
      sort_order: filters.sort_order
    };

    if (filters.search) params.search = filters.search;
    if (filters.status) params.status = filters.status;

    return params;
  }, [filters]);

  const loadApplications = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/applications', { params: apiParams });
      setItems(response.data.items);
      setPagination(response.data.pagination);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Failed to load applications');
    } finally {
      setLoading(false);
    }
  }, [apiParams]);

  useEffect(() => {
    loadApplications();
  }, [loadApplications]);

  async function handleCreate(values) {
    setActionLoading(true);
    setError('');
    try {
      await api.post('/applications', values);
      setFormOpen(false);
      // Reuse the same list loader after every mutation so table state stays consistent.
      await loadApplications();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Failed to create application');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleUpdate(values) {
    if (!editingItem) return;

    setActionLoading(true);
    setError('');

    try {
      await api.put(`/applications/${editingItem.id}`, values);
      setFormOpen(false);
      setEditingItem(null);
      await loadApplications();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Failed to update application');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this application?')) return;

    setActionLoading(true);
    setError('');
    try {
      await api.delete(`/applications/${id}`);
      await loadApplications();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Failed to delete application');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleTransition(id, status) {
    setActionLoading(true);
    setError('');
    try {
      // Workflow buttons call a dedicated transition endpoint that validates allowed moves.
      await api.patch(`/applications/${id}/transition`, { status });
      await loadApplications();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Failed to move status');
    } finally {
      setActionLoading(false);
    }
  }

  function openCreateModal() {
    setEditingItem(null);
    setFormOpen(true);
  }

  function openEditModal(item) {
    setEditingItem(item);
    setFormOpen(true);
  }

  function closeModal() {
    if (actionLoading) return;
    setFormOpen(false);
    setEditingItem(null);
  }

  return (
    <div className="applications-page">
      <section className="page-header page-header-inline">
        <div>
          <h2>Applications</h2>
          <p>Track every role with clear status transitions.</p>
        </div>
        <button type="button" className="primary-button" onClick={openCreateModal}>
          New Application
        </button>
      </section>

      <section className="panel filters-panel">
        <label>
          Search
          <input
            type="text"
            placeholder="Company, role, location"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </label>

        <label>
          Status
          <select
            value={filters.status}
            onChange={(event) =>
              setFilters((prev) => ({
                ...prev,
                status: event.target.value,
                page: 1
              }))
            }
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Sort By
          <select
            value={filters.sort_by}
            onChange={(event) =>
              setFilters((prev) => ({
                ...prev,
                sort_by: event.target.value
              }))
            }
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Order
          <select
            value={filters.sort_order}
            onChange={(event) =>
              setFilters((prev) => ({
                ...prev,
                sort_order: event.target.value
              }))
            }
          >
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </label>
      </section>

      {error && <div className="panel error-text">{error}</div>}

      <section className="panel table-panel">
        {loading ? (
          <p>Loading applications...</p>
        ) : items.length === 0 ? (
          <p>No applications found for the current filters.</p>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Applied</th>
                    <th>Salary</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.company}</strong>
                        <div className="muted">{item.location || 'No location'}</div>
                      </td>
                      <td>{item.role}</td>
                      <td>
                        <span className={`pill status-${item.status}`}>{STATUS_LABELS[item.status]}</span>
                      </td>
                      <td>{item.applied_date}</td>
                      <td>
                        {item.salary_min || item.salary_max
                          ? `${formatCurrency(item.salary_min)} - ${formatCurrency(item.salary_max)}`
                          : '-'}
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="ghost-button"
                            disabled={actionLoading}
                            onClick={() => openEditModal(item)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="ghost-button danger"
                            disabled={actionLoading}
                            onClick={() => handleDelete(item.id)}
                          >
                            Delete
                          </button>
                        </div>
                        {TRANSITIONS[item.status].length > 0 && (
                          <div className="row-transitions">
                            {TRANSITIONS[item.status].map((nextStatus) => (
                              <button
                                key={nextStatus}
                                type="button"
                                className="tiny-button"
                                disabled={actionLoading}
                                onClick={() => handleTransition(item.id, nextStatus)}
                              >
                                Move to {STATUS_LABELS[nextStatus]}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pagination">
              <span>
                Page {pagination.page} of {pagination.total_pages} ({pagination.total} total)
              </span>
              <div className="pagination-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={filters.page <= 1 || loading}
                  onClick={() =>
                    setFilters((prev) => ({
                      ...prev,
                      page: Math.max(1, prev.page - 1)
                    }))
                  }
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={filters.page >= pagination.total_pages || loading}
                  onClick={() =>
                    setFilters((prev) => ({
                      ...prev,
                      page: Math.min(pagination.total_pages, prev.page + 1)
                    }))
                  }
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      <ApplicationFormModal
        open={formOpen}
        initialData={editingItem}
        onClose={closeModal}
        onSubmit={editingItem ? handleUpdate : handleCreate}
        isSubmitting={actionLoading}
      />
    </div>
  );
}

export default ApplicationsPage;
