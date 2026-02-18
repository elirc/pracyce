import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from './lib/api';
import socket from './lib/socket';

const CHANNEL_OPTIONS = [
  { value: 'dine_in', label: 'Dine-in' },
  { value: 'delivery_app', label: 'Delivery App' },
  { value: 'phone', label: 'Phone' }
];

const STATIONS = ['grill', 'fryer', 'salad'];

const EMPTY_FORM = {
  channel: 'dine_in',
  ticketName: '',
  targetMinutes: 20,
  lines: [{ menuItemId: '', notes: '' }]
};

function formatTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString();
}

function formatChannel(channel) {
  const hit = CHANNEL_OPTIONS.find((entry) => entry.value === channel);
  return hit ? hit.label : channel;
}

function dueLabel(order) {
  const due = new Date(order.due_at).getTime();
  const now = Date.now();
  const diffMin = Math.round((due - now) / 60000);
  if (diffMin >= 0) return `${diffMin}m left`;
  return `${Math.abs(diffMin)}m late`;
}

function getAllowedNextStatuses(status) {
  if (status === 'queued') return ['started', 'cooking', 'ready'];
  if (status === 'started') return ['cooking', 'ready'];
  if (status === 'cooking') return ['ready'];
  return [];
}

function summarizeOrder(order) {
  const total = order.items.length;
  const ready = order.items.filter((item) => item.status === 'ready').length;
  const eighty = order.items.filter((item) => item.status === 'eighty_sixed').length;
  const active = order.items.filter((item) => item.status === 'started' || item.status === 'cooking').length;
  return { total, ready, eighty, active };
}

function App() {
  const [menuItems, setMenuItems] = useState([]);
  const [orders, setOrders] = useState([]);
  const [lateAlerts, setLateAlerts] = useState([]);
  const [stationBoards, setStationBoards] = useState({ grill: [], fryer: [], salad: [] });
  const [selectedStation, setSelectedStation] = useState('grill');
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [socketState, setSocketState] = useState(socket.connected ? 'connected' : 'disconnected');

  const refreshTimerRef = useRef(null);

  const availableMenuItems = useMemo(() => menuItems.filter((item) => item.is_available === 1), [menuItems]);

  const stats = useMemo(() => {
    const queued = orders.filter((order) => order.status === 'queued').length;
    const inProgress = orders.filter((order) => order.status === 'in_progress').length;
    const ready = orders.filter((order) => order.status === 'ready').length;
    return {
      total: orders.length,
      queued,
      inProgress,
      ready,
      late: lateAlerts.length
    };
  }, [orders, lateAlerts]);

  const loadEverything = useCallback(async () => {
    try {
      const [menuResponse, ordersResponse, lateResponse, grillResponse, fryerResponse, saladResponse] = await Promise.all([
        api.get('/menu-items'),
        api.get('/orders'),
        api.get('/alerts/late'),
        api.get('/stations/grill/board'),
        api.get('/stations/fryer/board'),
        api.get('/stations/salad/board')
      ]);

      setMenuItems(menuResponse.data.items);
      setOrders(ordersResponse.data.items);
      setLateAlerts(lateResponse.data.items);
      setStationBoards({
        grill: grillResponse.data.items,
        fryer: fryerResponse.data.items,
        salad: saladResponse.data.items
      });
      setError('');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Failed to load kitchen data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEverything();
    const fallbackPoll = setInterval(loadEverything, 12000);

    return () => clearInterval(fallbackPoll);
  }, [loadEverything]);

  useEffect(() => {
    const onConnect = () => setSocketState('connected');
    const onDisconnect = () => setSocketState('disconnected');

    const onKitchenEvent = () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }

      refreshTimerRef.current = setTimeout(() => {
        loadEverything();
      }, 250);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('kds_event', onKitchenEvent);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('kds_event', onKitchenEvent);
    };
  }, [loadEverything]);

  async function handleCreateOrder(event) {
    event.preventDefault();
    setError('');
    setNotice('');

    const cleanLines = form.lines
      .filter((line) => line.menuItemId)
      .map((line) => ({
        menuItemId: line.menuItemId,
        notes: line.notes?.trim() ? line.notes.trim() : undefined
      }));

    if (cleanLines.length === 0) {
      setError('Add at least one item to the order.');
      return;
    }

    setSubmitting(true);

    try {
      const response = await api.post('/orders', {
        channel: form.channel,
        ticketName: form.ticketName.trim() || undefined,
        targetMinutes: Number(form.targetMinutes),
        items: cleanLines
      });

      setNotice(`Order created: ${response.data.order.id.slice(0, 8)}`);
      setForm(EMPTY_FORM);
      await loadEverything();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Failed to create order');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBumpPriority(orderId, priority) {
    setError('');
    try {
      await api.patch(`/orders/${orderId}/priority`, { priority });
      setNotice(`Order bumped to ${priority.toUpperCase()}.`);
      await loadEverything();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Failed to bump priority');
    }
  }

  async function handleItemStatus(itemId, status) {
    setError('');
    try {
      await api.patch(`/order-items/${itemId}/status`, { status });
      await loadEverything();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Failed to update item status');
    }
  }

  async function handleEightySixItem(itemId) {
    const reason = window.prompt('Reason for 86 item (optional):') || undefined;

    setError('');
    try {
      await api.patch(`/order-items/${itemId}/eighty-six`, { reason });
      setNotice('Item marked 86d.');
      await loadEverything();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Failed to 86 item');
    }
  }

  async function handleToggleMenuAvailability(menuItem) {
    const isAvailable = menuItem.is_available === 1;
    const nextAvailability = !isAvailable;

    let reason;
    if (!nextAvailability) {
      reason = window.prompt(`Reason for 86'ing ${menuItem.name}:`) || undefined;
    }

    setError('');
    try {
      await api.patch(`/menu-items/${menuItem.id}/availability`, {
        isAvailable: nextAvailability,
        reason
      });
      setNotice(
        nextAvailability
          ? `${menuItem.name} is available again.`
          : `${menuItem.name} marked 86d and affected items were updated.`
      );
      await loadEverything();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Failed to update availability');
    }
  }

  function addLine() {
    setForm((prev) => ({
      ...prev,
      lines: [...prev.lines, { menuItemId: '', notes: '' }]
    }));
  }

  function removeLine(index) {
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.filter((_, idx) => idx !== index)
    }));
  }

  function updateLine(index, next) {
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.map((line, idx) => (idx === index ? { ...line, ...next } : line))
    }));
  }

  if (loading) {
    return <div className="page"><section className="panel">Loading KDS...</section></div>;
  }

  return (
    <div className="page">
      <header className="hero">
        <h1>Restaurant Kitchen Display System</h1>
        <p>Fan-out item routing, fan-in order readiness, live station flow, and late service alerts.</p>
        <span className={`socket-pill ${socketState}`}>{socketState}</span>
      </header>

      {error && <section className="alert error">{error}</section>}
      {notice && <section className="alert success">{notice}</section>}

      <section className="stats-grid">
        <article className="stat"><span>Total Orders</span><strong>{stats.total}</strong></article>
        <article className="stat"><span>Queued</span><strong>{stats.queued}</strong></article>
        <article className="stat"><span>In Progress</span><strong>{stats.inProgress}</strong></article>
        <article className="stat"><span>Ready</span><strong>{stats.ready}</strong></article>
        <article className="stat danger"><span>Late Alerts</span><strong>{stats.late}</strong></article>
      </section>

      <section className="grid two-col">
        <article className="panel">
          <h2>New Order Intake</h2>
          <form className="order-form" onSubmit={handleCreateOrder}>
            <label>
              Channel
              <select value={form.channel} onChange={(event) => setForm((prev) => ({ ...prev, channel: event.target.value }))}>
                {CHANNEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label>
              Ticket Name
              <input
                value={form.ticketName}
                onChange={(event) => setForm((prev) => ({ ...prev, ticketName: event.target.value }))}
                placeholder="Table 14 / Jane D"
              />
            </label>

            <label>
              Target Minutes
              <input
                type="number"
                min="5"
                max="120"
                value={form.targetMinutes}
                onChange={(event) => setForm((prev) => ({ ...prev, targetMinutes: event.target.value }))}
              />
            </label>

            <div className="line-items">
              {form.lines.map((line, index) => (
                <div key={`line-${index}`} className="line-row">
                  <select
                    value={line.menuItemId}
                    onChange={(event) => updateLine(index, { menuItemId: event.target.value })}
                  >
                    <option value="">Select item...</option>
                    {availableMenuItems.map((item) => (
                      <option key={item.id} value={item.id}>{item.name} ({item.station})</option>
                    ))}
                  </select>

                  <input
                    value={line.notes}
                    onChange={(event) => updateLine(index, { notes: event.target.value })}
                    placeholder="Item note"
                  />

                  <button type="button" className="secondary" onClick={() => removeLine(index)} disabled={form.lines.length === 1}>
                    Remove
                  </button>
                </div>
              ))}
            </div>

            <div className="actions-row">
              <button type="button" className="secondary" onClick={addLine}>Add Item</button>
              <button type="submit" disabled={submitting}>{submitting ? 'Submitting...' : 'Send to Kitchen'}</button>
            </div>
          </form>
        </article>

        <article className="panel">
          <h2>86 Control (Mid-Service)</h2>
          <div className="menu-grid">
            {menuItems.map((item) => (
              <div key={item.id} className={`menu-row ${item.is_available === 1 ? '' : 'disabled'}`}>
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.station}</span>
                </div>
                <button
                  type="button"
                  className={item.is_available === 1 ? 'danger' : 'secondary'}
                  onClick={() => handleToggleMenuAvailability(item)}
                >
                  {item.is_available === 1 ? "86 Item" : 'Restore'}
                </button>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="panel">
        <h2>Expeditor Orders</h2>
        {orders.length === 0 ? (
          <p>No orders in system.</p>
        ) : (
          <div className="orders-grid">
            {orders.map((order) => {
              const summary = summarizeOrder(order);
              return (
                <article key={order.id} className={`order-card ${order.is_late ? 'late' : ''}`}>
                  <header>
                    <div>
                      <h3>{order.ticket_name || order.id.slice(0, 8)}</h3>
                      <p>{formatChannel(order.channel)} | Due {formatTime(order.due_at)} ({dueLabel(order)})</p>
                    </div>
                    <div className="badges">
                      <span className={`badge priority-${order.priority}`}>{order.priority}</span>
                      <span className={`badge status-${order.status}`}>{order.status}</span>
                      {order.has_eighty_six ? <span className="badge status-eighty">86</span> : null}
                    </div>
                  </header>

                  <p className="summary">{summary.ready + summary.eighty}/{summary.total} done | {summary.active} active</p>

                  <div className="bump-actions">
                    {order.priority !== 'high' && order.priority !== 'rush' ? (
                      <button type="button" className="secondary" onClick={() => handleBumpPriority(order.id, 'high')}>Bump High</button>
                    ) : null}
                    {order.priority !== 'rush' ? (
                      <button type="button" className="danger" onClick={() => handleBumpPriority(order.id, 'rush')}>Bump Rush</button>
                    ) : null}
                  </div>

                  <div className="item-list">
                    {order.items.map((item) => (
                      <div key={item.id} className={`item-row ${item.status === 'eighty_sixed' ? 'eighty' : ''}`}>
                        <div>
                          <strong>{item.item_name}</strong>
                          <span>{item.station} | {item.status}</span>
                        </div>
                        <div className="item-actions">
                          {getAllowedNextStatuses(item.status).map((nextStatus) => (
                            <button
                              key={nextStatus}
                              type="button"
                              className="tiny"
                              onClick={() => handleItemStatus(item.id, nextStatus)}
                            >
                              {nextStatus}
                            </button>
                          ))}
                          {item.status !== 'ready' && item.status !== 'eighty_sixed' ? (
                            <button type="button" className="tiny danger" onClick={() => handleEightySixItem(item.id)}>86</button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid two-col">
        <article className="panel">
          <h2>Station Board</h2>
          <div className="station-tabs">
            {STATIONS.map((station) => (
              <button
                key={station}
                type="button"
                className={selectedStation === station ? 'active-tab' : 'secondary'}
                onClick={() => setSelectedStation(station)}
              >
                {station}
              </button>
            ))}
          </div>

          <div className="station-items">
            {(stationBoards[selectedStation] || []).length === 0 ? (
              <p>No active items for this station.</p>
            ) : (
              stationBoards[selectedStation].map((item) => (
                <div key={item.id} className={`station-item ${item.is_late ? 'late' : ''}`}>
                  <div>
                    <strong>{item.item_name}</strong>
                    <p>
                      {item.ticket_name || item.order_id.slice(0, 8)} | {formatChannel(item.channel)} | {item.priority}
                    </p>
                    <p>Due {formatTime(item.due_at)} ({dueLabel({ due_at: item.due_at })})</p>
                    <span className={`badge status-${item.status}`}>{item.status}</span>
                  </div>
                  <div className="item-actions">
                    {getAllowedNextStatuses(item.status).map((nextStatus) => (
                      <button key={nextStatus} type="button" className="tiny" onClick={() => handleItemStatus(item.id, nextStatus)}>
                        {nextStatus}
                      </button>
                    ))}
                    <button type="button" className="tiny danger" onClick={() => handleEightySixItem(item.id)}>86</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="panel">
          <h2>Late Order Alerts</h2>
          {lateAlerts.length === 0 ? (
            <p>No late orders right now.</p>
          ) : (
            <div className="late-list">
              {lateAlerts.map((order) => (
                <div key={order.id} className="late-row">
                  <div>
                    <strong>{order.ticket_name || order.id.slice(0, 8)}</strong>
                    <p>{formatChannel(order.channel)} | Priority {order.priority}</p>
                  </div>
                  <div>
                    <span>{dueLabel(order)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>
    </div>
  );
}

export default App;