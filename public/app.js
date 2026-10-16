// Frontend controller: collects input, calls the backend API and renders a structured plan.
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const list = (items) => (items && items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p class="muted">None noted.</p>');

  const SAMPLES = [
    { featureIdea: 'Let customers book salon appointments online, pay a deposit by card, and receive SMS reminders 24 hours before the visit. Staff should see a daily calendar and be able to reschedule.', context: 'B2C salon booking app with 5k monthly users', businessPriority: 'high' },
    { featureIdea: 'Add real-time team chat with channels, direct messages, file upload, message search and push notifications for mentions.', context: 'B2B project management SaaS', businessPriority: 'medium' },
    { featureIdea: 'Employees can submit expense reports with receipt photos, managers approve or reject them, and finance can export approved expenses to CSV for payroll. Integrate with our existing SSO login.', context: 'Internal HR tool for a 300-person company', businessPriority: 'critical' },
  ];

  let current = null;

  // ---------- Input ----------
  const idea = $('#featureIdea');
  idea.addEventListener('input', () => ($('#charCount').textContent = idea.value.length));

  $$('[data-sample]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const s = SAMPLES[btn.dataset.sample];
      idea.value = s.featureIdea;
      $('#context').value = s.context;
      $('#businessPriority').value = s.businessPriority;
      idea.dispatchEvent(new Event('input'));
    })
  );

  function readForm() {
    return {
      featureIdea: idea.value.trim(),
      context: $('#context').value.trim(),
      businessPriority: $('#businessPriority').value,
      sprintCapacity: Number($('#sprintCapacity').value),
      sprintLengthWeeks: Number($('#sprintLengthWeeks').value),
      useAI: $('#useAI').checked,
    };
  }

  function validate(data) {
    if (data.featureIdea.length < 20) return 'Please describe the feature in at least 20 characters.';
    if (!(data.sprintCapacity >= 5 && data.sprintCapacity <= 100)) return 'Points per sprint must be between 5 and 100.';
    return null;
  }

  $('#ideaForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = readForm();
    const err = validate(data);
    const errBox = $('#formError');
    errBox.hidden = !err;
    errBox.textContent = err || '';
    if (err) return;

    setLoading(true);
    animatePipeline();
    try {
      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Request failed');
      showResult(body);
    } catch (ex) {
      errBox.hidden = false;
      errBox.textContent = `Could not generate the plan: ${ex.message}`;
      resetPipeline();
      // Restore whatever was on screen before the failed request
      $('#emptyState').hidden = !!current;
      $('#result').hidden = !current;
    } finally {
      setLoading(false);
    }
  });

  function setLoading(on) {
    $('#submitBtn').disabled = on;
    $('#submitBtn').textContent = on ? 'Generating…' : 'Generate plan';
    $('#loading').hidden = !on;
    if (on) {
      $('#emptyState').hidden = true;
      $('#result').hidden = true;
    }
  }

  // ---------- Pipeline indicator ----------
  let pipeTimer = null;
  const STEP_TEXT = {
    input: 'Validating input…', api: 'Sending to backend…', generation: 'Generating PRD and tasks…',
    logic: 'Scoring priority, effort and dependencies…', storage: 'Saving workflow…', output: 'Rendering plan…',
  };
  function resetPipeline() {
    clearInterval(pipeTimer);
    $$('#pipeline li').forEach((li) => {
      li.className = '';
      li.querySelector('.ms')?.remove();
    });
  }
  function animatePipeline() {
    resetPipeline();
    const steps = [...$$('#pipeline li')];
    let i = 0;
    const tick = () => {
      steps.forEach((li, idx) => (li.className = idx < i ? 'done' : idx === i ? 'active' : ''));
      $('#loadingText').textContent = STEP_TEXT[steps[i]?.dataset.step] || 'Working…';
      if (i < steps.length - 2) i++;
    };
    tick();
    pipeTimer = setInterval(tick, 700);
  }
  function finishPipeline(trace = []) {
    clearInterval(pipeTimer);
    const byStep = Object.fromEntries(trace.map((t) => [t.step, t]));
    $$('#pipeline li').forEach((li) => {
      const t = byStep[li.dataset.step];
      li.className = t?.status === 'fallback' ? 'fallback' : 'done';
      li.querySelector('.ms')?.remove();
      const ms = document.createElement('span');
      ms.className = 'ms';
      ms.textContent = t ? (t.detail ? `${t.ms}ms · ${t.detail}` : `${t.ms}ms`) : '—';
      li.appendChild(ms);
    });
  }

  // ---------- Rendering ----------
  function showResult(wf) {
    current = wf;
    finishPipeline(wf.pipeline);
    $('#loading').hidden = true;
    $('#emptyState').hidden = true;
    $('#result').hidden = false;
    $('#resTitle').textContent = wf.prd.title;
    const created = new Date(wf.createdAt).toLocaleString();
    $('#resMeta').innerHTML = `Workflow #${esc(wf.id ?? '—')} · ${esc(created)} · <span class="badge src-${esc(wf.source)}">${wf.source === 'ai' ? 'AI generated' : 'Rule-based'}</span>`;
    renderOverview(wf);
    renderPRD(wf);
    renderStories(wf);
    renderTasks(wf);
    renderSprints(wf);
    selectTab('overview');
  }

  function stat(label, value, sub = '') {
    return `<div class="stat"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>`;
  }

  function renderOverview(wf) {
    const s = wf.summary;
    const r = wf.risk;
    const counts = { P0: 0, P1: 0, P2: 0, P3: 0 };
    wf.tasks.forEach((t) => counts[t.priority.level]++);
    const riskColor = { high: 'var(--p0)', medium: 'var(--p1)', low: 'var(--p2)' }[r.level];
    const crit = (s.criticalPath || []).map((id) => wf.tasks.find((t) => t.id === id)).filter(Boolean);

    $('#tab-overview').innerHTML = `
      <div class="stats">
        ${stat('User stories', s.storyCount)}
        ${stat('Engineering tasks', s.taskCount)}
        ${stat('Total effort', `${s.totalPoints} pts`, `≈ ${s.totalHours} hours`)}
        ${stat('Sprints', s.sprintCount, `${s.durationWeeks} weeks`)}
        ${stat('Risk', r.level.toUpperCase(), `score ${r.score}/100`)}
      </div>
      <p>${esc(wf.prd.summary)}</p>
      <div class="grid-2">
        <div class="card">
          <h4>Delivery risk <span class="badge risk-${esc(r.level)}">${esc(r.level)}</span></h4>
          <div class="meter"><span style="width:${r.score}%;background:${riskColor}"></span></div>
          <ul class="risk-list">${r.factors.map((f) => `<li><strong>${esc(f.factor)}</strong> <span class="muted">(+${f.impact})</span><br><span class="muted">Mitigation: ${esc(f.mitigation)}</span></li>`).join('') || '<li class="muted">No significant risk factors detected.</li>'}</ul>
        </div>
        <div class="card">
          <h4>Priority mix</h4>
          ${['P0', 'P1', 'P2', 'P3'].map((p) => `
            <div style="display:flex;align-items:center;gap:8px;margin:6px 0">
              <span class="badge ${p}" style="width:36px;text-align:center">${p}</span>
              <div class="meter" style="flex:1"><span style="width:${s.taskCount ? (counts[p] / s.taskCount) * 100 : 0}%;background:var(--accent)"></span></div>
              <span class="mono">${counts[p]}</span>
            </div>`).join('')}
          <h4 style="margin-top:14px">Critical path</h4>
          <p class="muted" style="font-size:13px;margin:0 0 6px">The longest chain of dependent tasks — delays here delay the release.</p>
          <ol style="margin:0;padding-left:20px">${crit.map((t) => `<li><span class="mono">${esc(t.id)}</span> ${esc(t.title)} <span class="muted">(${t.effort.points} pts)</span></li>`).join('')}</ol>
        </div>
      </div>`;
  }

  function renderPRD(wf) {
    const p = wf.prd;
    $('#tab-prd').innerHTML = `
      <div class="section"><h3>Overview</h3><p>${esc(p.summary)}</p></div>
      <div class="section"><h3>Problem statement</h3><p>${esc(p.problem)}</p></div>
      <div class="grid-2 section">
        <div class="card"><h4>Goals</h4>${list(p.goals)}</div>
        <div class="card"><h4>Non-goals</h4>${list(p.nonGoals)}</div>
      </div>
      <div class="section"><h3>Target users</h3>
        <div class="grid-2">${(p.personas || []).map((u) => `<div class="card"><h4>${esc(u.name)}</h4><p style="margin:0">${esc(u.need)}</p></div>`).join('')}</div>
      </div>
      <div class="grid-2 section">
        <div class="card"><h4>Functional requirements</h4>${list(p.requirements?.functional)}</div>
        <div class="card"><h4>Non-functional requirements</h4>${list(p.requirements?.nonFunctional)}</div>
      </div>
      <div class="grid-2 section">
        <div class="card"><h4>Success metrics</h4>${list(p.metrics)}</div>
        <div class="card"><h4>Assumptions &amp; open questions</h4>${list([...(p.assumptions || []), ...(p.openQuestions || []).map((q) => `Open: ${q}`)])}</div>
      </div>`;
  }

  function renderStories(wf) {
    $('#tab-stories').innerHTML = wf.stories.map((s) => {
      const taskCount = wf.tasks.filter((t) => t.storyId === s.id).length;
      return `<div class="story">
        <div class="story-head"><strong class="mono">${esc(s.id)}</strong><span><span class="badge ${esc(s.moscow.toLowerCase())}">${esc(s.moscow)}</span> <span class="muted" style="font-size:12px">${taskCount} task${taskCount === 1 ? '' : 's'}</span></span></div>
        <p>As a <strong>${esc(s.persona)}</strong>, I want to <strong>${esc(s.action)}</strong> so that ${esc(s.benefit)}.</p>
        <div class="muted" style="font-size:12px;font-weight:600">Acceptance criteria</div>
        ${list(s.acceptance)}
      </div>`;
    }).join('');
  }

  function renderTasks(wf) {
    const types = [...new Set(wf.tasks.map((t) => t.type))];
    $('#tab-tasks').innerHTML = `
      <div class="filters">
        <select id="fPriority" aria-label="Filter by priority"><option value="">All priorities</option>${['P0', 'P1', 'P2', 'P3'].map((p) => `<option>${p}</option>`).join('')}</select>
        <select id="fType" aria-label="Filter by type"><option value="">All types</option>${types.map((t) => `<option>${esc(t)}</option>`).join('')}</select>
        <select id="fSort" aria-label="Sort tasks"><option value="sprint">Sort by sprint</option><option value="score">Sort by priority score</option><option value="effort">Sort by effort</option></select>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>ID</th><th>Task</th><th>Type</th><th>Priority</th><th>Effort</th><th>Depends on</th><th>Sprint</th></tr></thead>
        <tbody id="taskRows"></tbody>
      </table></div>`;
    const draw = () => {
      const fp = $('#fPriority').value, ft = $('#fType').value, sort = $('#fSort').value;
      let rows = wf.tasks.filter((t) => (!fp || t.priority.level === fp) && (!ft || t.type === ft));
      rows = rows.slice().sort((a, b) =>
        sort === 'score' ? b.priority.score - a.priority.score : sort === 'effort' ? b.effort.points - a.effort.points : a.sprint - b.sprint || b.priority.score - a.priority.score);
      $('#taskRows').innerHTML = rows.map((t) => `<tr>
        <td class="mono">${esc(t.id)}</td>
        <td><strong>${esc(t.title)}</strong><span class="why">${esc(t.description)}</span><span class="why">Story ${esc(t.storyId)}</span></td>
        <td><span class="badge type">${esc(t.type)}</span></td>
        <td><span class="badge ${t.priority.level}">${t.priority.level}</span> <span class="mono">${t.priority.score}</span><span class="why">${esc(t.priority.reasons.join('; '))}</span></td>
        <td class="mono">${t.effort.points} pts<span class="why">≈${t.effort.hours}h · ${esc(t.effort.reasons.join('; '))}</span></td>
        <td class="mono">${t.dependsOn.length ? t.dependsOn.map((d) => `<span style="white-space:nowrap">${esc(d)}</span>`).join(', ') : '—'}</td>
        <td class="mono">S${t.sprint}</td>
      </tr>`).join('') || '<tr><td colspan="7" class="muted">No tasks match the filters.</td></tr>';
    };
    ['#fPriority', '#fType', '#fSort'].forEach((s) => $(s).addEventListener('change', draw));
    draw();
  }

  function renderSprints(wf) {
    const byId = Object.fromEntries(wf.tasks.map((t) => [t.id, t]));
    $('#tab-sprints').innerHTML = `
      <p class="muted">Capacity ${wf.input.sprintCapacity} points per ${wf.input.sprintLengthWeeks}-week sprint. Tasks are placed in priority order, never before the tasks they depend on.</p>
      <div class="sprint-board">${wf.sprints.map((sp) => `
        <div class="sprint">
          <div class="sprint-head"><h4 style="margin:0">${esc(sp.name)}</h4><span class="mono">${sp.points}/${sp.capacity} pts</span></div>
          <div class="muted" style="font-size:12px">Weeks ${sp.startWeek}–${sp.endWeek}</div>
          <div class="capacity ${sp.points > sp.capacity ? 'over' : ''}"><span style="width:${Math.min(100, sp.utilization)}%"></span></div>
          <p class="sprint-goal">${esc(sp.goal)}</p>
          ${sp.taskIds.map((id) => byId[id]).map((t) => `
            <div class="task-card">
              <div class="tc-head"><span><span class="mono">${esc(t.id)}</span> ${esc(t.title)}</span></div>
              <div class="tc-meta"><span class="badge ${t.priority.level}">${t.priority.level}</span><span class="badge type">${esc(t.type)}</span><span class="mono">${t.effort.points} pts</span>${t.dependsOn.length ? `<span class="muted" style="font-size:12px">after ${t.dependsOn.map(esc).join(', ')}</span>` : ''}</div>
            </div>`).join('')}
        </div>`).join('')}
      </div>`;
  }

  // ---------- Tabs ----------
  function selectTab(name) {
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    $$('.tab-panel').forEach((p) => (p.hidden = p.id !== `tab-${name}`));
  }
  $$('.tab').forEach((t) => t.addEventListener('click', () => selectTab(t.dataset.tab)));

  // ---------- Export ----------
  $('#exportBtn').addEventListener('click', () => {
    if (!current) return;
    const wf = current, p = wf.prd;
    const bl = (a) => (a || []).map((x) => `- ${x}`).join('\n');
    const md = [
      `# ${p.title}`, '', p.summary, '', '## Problem', p.problem, '', '## Goals', bl(p.goals), '', '## Non-goals', bl(p.nonGoals), '',
      '## Users', (p.personas || []).map((u) => `- **${u.name}**: ${u.need}`).join('\n'), '',
      '## Functional requirements', bl(p.requirements?.functional), '', '## Non-functional requirements', bl(p.requirements?.nonFunctional), '',
      '## Success metrics', bl(p.metrics), '', '## User stories',
      wf.stories.map((s) => `### ${s.id} (${s.moscow})\nAs a ${s.persona}, I want to ${s.action} so that ${s.benefit}.\n${bl(s.acceptance)}`).join('\n\n'), '',
      '## Tasks', '| ID | Task | Type | Priority | Points | Depends on | Sprint |', '|---|---|---|---|---|---|---|',
      wf.tasks.map((t) => `| ${t.id} | ${t.title} | ${t.type} | ${t.priority.level} (${t.priority.score}) | ${t.effort.points} | ${t.dependsOn.join(', ') || '-'} | ${t.sprint} |`).join('\n'), '',
      '## Sprint plan', wf.sprints.map((s) => `### ${s.name} (${s.points}/${s.capacity} pts)\n${s.goal}\n${bl(s.taskIds.map((id) => `${id} ${wf.tasks.find((t) => t.id === id).title}`))}`).join('\n\n'), '',
      `## Risk: ${wf.risk.level} (${wf.risk.score}/100)`, bl(wf.risk.factors.map((f) => `${f.factor} — ${f.mitigation}`)),
    ].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    a.download = `${p.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.md`;
    a.click();
  });

  // ---------- History ----------
  const drawer = $('#historyDrawer');
  function openHistory(open) {
    drawer.classList.toggle('open', open);
    drawer.setAttribute('aria-hidden', String(!open));
    $('#scrim').hidden = !open;
    if (open) loadHistory();
  }
  $('#historyBtn').addEventListener('click', () => openHistory(true));
  $('#closeHistory').addEventListener('click', () => openHistory(false));
  $('#scrim').addEventListener('click', () => openHistory(false));

  let searchTimer;
  $('#historySearch').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadHistory, 250);
  });

  async function loadHistory() {
    const ul = $('#historyList');
    try {
      const q = encodeURIComponent($('#historySearch').value.trim());
      const res = await fetch(`/api/workflows?limit=50&q=${q}`);
      if (!res.ok) throw new Error();
      const { items } = await res.json();
      ul.innerHTML = items.map((w) => `<li data-id="${w.id}">
        <div class="h-title">${esc(w.title)}</div>
        <div class="h-meta">#${w.id} · ${esc(new Date(w.createdAt).toLocaleDateString())} · ${w.taskCount} tasks · ${w.totalPoints} pts <span class="badge risk-${esc(w.riskLevel)}">${esc(w.riskLevel)} risk</span></div>
      </li>`).join('') || '<li class="muted" style="cursor:default">No saved workflows yet.</li>';
      ul.querySelectorAll('li[data-id]').forEach((li) => li.addEventListener('click', () => openWorkflow(li.dataset.id)));
    } catch {
      ul.innerHTML = '<li class="muted" style="cursor:default">History is not available.</li>';
    }
  }

  async function openWorkflow(id) {
    const res = await fetch(`/api/workflows/${id}`);
    if (!res.ok) return;
    openHistory(false);
    showResult(await res.json());
  }

  // Deep link: /?id=12 opens a saved workflow
  const deep = new URLSearchParams(location.search).get('id');
  if (deep) openWorkflow(deep);
})();
