// Admin dashboard controller: metrics, workflow management and activity log.
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PAGE = 15;
  let offset = 0;
  let total = 0;

  function adminKey() {
    try { return sessionStorage.getItem('adminKey') || ''; } catch { return ''; }
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey(), ...(opts.headers || {}) } });
    if (res.status === 401) {
      const key = prompt('Admin key required:');
      if (key) {
        try { sessionStorage.setItem('adminKey', key); } catch {}
        return api(path, opts);
      }
    }
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
  }

  function showError(msg) {
    const box = $('#adminError');
    box.hidden = !msg;
    box.textContent = msg || '';
  }

  const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);
  const fmtUptime = (s) => (s > 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}m ${s % 60}s`);

  function stat(label, value, sub = '') {
    return `<div class="stat"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>`;
  }

  function hbars(map, order, labels = {}, classes = {}) {
    const keys = order || Object.keys(map);
    const max = Math.max(1, ...keys.map((k) => map[k] || 0));
    return keys.map((k) => `<div class="hbar">
        <span>${classes[k] ? `<span class="badge ${classes[k]}">${esc(labels[k] || k)}</span>` : esc(labels[k] || k)}</span>
        <div class="track"><div class="fill" style="width:${((map[k] || 0) / max) * 100}%"></div></div>
        <span class="n">${map[k] || 0}</span>
      </div>`).join('') || '<p class="muted">No data yet.</p>';
  }

  async function loadStats() {
    const s = await api('/api/admin/stats');
    const t = s.totals;
    const aiShare = t.workflows ? Math.round(((s.bySource.ai || 0) / t.workflows) * 100) : 0;
    $('#kpis').innerHTML = [
      stat('Total workflows', t.workflows, `${t.today} today · ${t.last7Days} this week`),
      stat('Tasks generated', t.tasks, `${t.storyPoints} story points`),
      stat('Avg processing', fmtMs(t.avgProcessingMs), `max ${fmtMs(t.maxProcessingMs)}`),
      stat('AI generated', `${aiShare}%`, `${t.fallbacks} fallbacks to rules`),
      stat('Avg risk score', t.avgRiskScore, `avg ${t.avgSprints} sprints / plan`),
      stat('Errors (24h)', t.errors24h, t.errors24h ? 'see activity log' : 'all clear'),
    ].join('');

    const max = Math.max(1, ...s.perDay.map((d) => d.count));
    $('#perDay').innerHTML = s.perDay.map((d) => {
      const label = new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      return `<div class="col ${d.count ? '' : 'zero'}">
        <span class="tip">${esc(label)}: ${d.count} workflow${d.count === 1 ? '' : 's'}</span>
        ${d.count ? `<span class="val">${d.count}</span>` : ''}
        <div class="bar" style="height:${(d.count / max) * 85}%"></div>
      </div>`;
    }).join('');
    const axis = document.querySelector('.axis') || Object.assign(document.createElement('div'), { className: 'axis' });
    axis.innerHTML = s.perDay.map((d, i) => `<span>${i % 2 === 0 ? esc(d.date.slice(5)) : ''}</span>`).join('');
    $('#perDay').after(axis);

    $('#source').innerHTML = hbars(s.bySource, ['ai', 'rules'], { ai: 'AI', rules: 'Rule-based' }, { ai: 'src-ai', rules: 'src-rules' });
    $('#risk').innerHTML = hbars(s.byRisk, ['high', 'medium', 'low'], {}, { high: 'risk-high', medium: 'risk-medium', low: 'risk-low' });
    $('#priority').innerHTML = hbars(s.tasksByPriority, ['P0', 'P1', 'P2', 'P3'], {}, { P0: 'P0', P1: 'P1', P2: 'P2', P3: 'P3' });
    $('#types').innerHTML = hbars(s.tasksByType);

    const sys = s.system;
    $('#system').innerHTML = `
      <dt>Status</dt><dd><span class="dot" style="background:var(--p2)"></span>Online</dd>
      <dt>Uptime</dt><dd>${fmtUptime(sys.uptimeSec)}</dd>
      <dt>Node.js</dt><dd>${esc(sys.node)}</dd>
      <dt>Database</dt><dd>SQLite (${esc(sys.dbDriver)})</dd>
      <dt>AI engine</dt><dd>${sys.aiEnabled ? esc(sys.aiModel) : 'Off — rule-based'}</dd>
      <dt>Admin auth</dt><dd>${sys.adminProtected ? 'Key required' : 'Open'}</dd>
      <dt>Memory</dt><dd>${sys.memoryMb} MB</dd>`;
  }

  async function loadWorkflows() {
    const params = new URLSearchParams({ q: $('#q').value.trim(), status: $('#fStatus').value, risk: $('#fRisk').value, source: $('#fSource').value, limit: PAGE, offset });
    const data = await api(`/api/admin/workflows?${params}`);
    total = data.total;
    $('#rows').innerHTML = data.items.map((w) => `<tr>
      <td class="mono">${w.id}</td>
      <td><a href="/?id=${w.id}" title="Open in planner">${esc(w.title)}</a><span class="why">${esc(w.featureIdea.slice(0, 90))}${w.featureIdea.length > 90 ? '…' : ''}</span></td>
      <td><span class="badge src-${esc(w.source)}">${w.source === 'ai' ? 'AI' : 'Rules'}</span></td>
      <td class="mono">${w.taskCount}</td>
      <td class="mono">${w.totalPoints}</td>
      <td class="mono">${w.sprintCount}</td>
      <td><span class="badge risk-${esc(w.riskLevel)}">${esc(w.riskLevel)} · ${w.riskScore}</span></td>
      <td class="mono">${fmtMs(w.processingMs)}</td>
      <td class="mono">${esc(new Date(w.createdAt).toLocaleString())}</td>
      <td><select class="status-select" data-id="${w.id}" aria-label="Status of workflow ${w.id}">
        ${['new', 'in_review', 'approved', 'archived'].map((s) => `<option value="${s}" ${s === w.status ? 'selected' : ''}>${s.replace('_', ' ')}</option>`).join('')}
      </select></td>
      <td><button type="button" class="danger" data-del="${w.id}">Delete</button></td>
    </tr>`).join('') || '<tr><td colspan="11" class="muted">No workflows match.</td></tr>';

    $('#pageInfo').textContent = total ? `${offset + 1}–${Math.min(offset + PAGE, total)} of ${total}` : '';
    $('#prev').disabled = offset === 0;
    $('#next').disabled = offset + PAGE >= total;

    document.querySelectorAll('.status-select').forEach((sel) => sel.addEventListener('change', async () => {
      try {
        await api(`/api/admin/workflows/${sel.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ status: sel.value }) });
        loadActivity();
        loadStats();
      } catch (e) { showError(e.message); }
    }));
    document.querySelectorAll('[data-del]').forEach((btn) => btn.addEventListener('click', async () => {
      if (!confirm(`Delete workflow #${btn.dataset.del}? This removes its tasks and sprints.`)) return;
      try {
        await api(`/api/admin/workflows/${btn.dataset.del}`, { method: 'DELETE' });
        refresh();
      } catch (e) { showError(e.message); }
    }));
  }

  async function loadActivity() {
    const level = $('#fLevel').value;
    const { items } = await api(`/api/admin/activity?limit=100&level=${level}`);
    $('#activity').innerHTML = items.map((a) => `<li>
      <span class="time">${esc(new Date(a.createdAt).toLocaleString())}</span>
      <span><span class="badge lvl-${esc(a.level)}">${esc(a.level)}</span></span>
      <span class="event">${esc(a.event)}</span>
      <span>${a.workflowId ? `<a href="/?id=${a.workflowId}" style="color:var(--accent)">#${a.workflowId}</a> ` : ''}${esc(a.message)}</span>
    </li>`).join('') || '<li class="muted">No activity yet.</li>';
  }

  async function refresh() {
    showError('');
    try {
      await Promise.all([loadStats(), loadWorkflows(), loadActivity()]);
    } catch (e) {
      showError(`Could not load dashboard: ${e.message}`);
    }
  }

  let qTimer;
  $('#q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => { offset = 0; loadWorkflows(); }, 250); });
  ['#fStatus', '#fRisk', '#fSource'].forEach((s) => $(s).addEventListener('change', () => { offset = 0; loadWorkflows(); }));
  $('#fLevel').addEventListener('change', loadActivity);
  $('#prev').addEventListener('click', () => { offset = Math.max(0, offset - PAGE); loadWorkflows(); });
  $('#next').addEventListener('click', () => { offset += PAGE; loadWorkflows(); });
  $('#refreshBtn').addEventListener('click', refresh);

  refresh();
  setInterval(loadStats, 30000); // live monitoring
})();
