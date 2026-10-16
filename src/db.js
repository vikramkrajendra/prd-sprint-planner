// Database layer (SQLite). Uses Node's built-in `node:sqlite` when available
// (Node 22.5+), otherwise falls back to the `better-sqlite3` package. Both expose
// the same synchronous prepare/run/get/all API, so the rest of the app is identical.
const fs = require('fs');
const path = require('path');
const config = require('./config');

function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    const { DatabaseSync } = require('node:sqlite');
    return { db: new DatabaseSync(file), driver: 'node:sqlite' };
  } catch {
    const Better = require('better-sqlite3');
    return { db: new Better(file), driver: 'better-sqlite3' };
  }
}

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workflows (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  title               TEXT    NOT NULL,
  feature_idea        TEXT    NOT NULL,
  context             TEXT,
  business_priority   TEXT    NOT NULL DEFAULT 'medium',
  sprint_capacity     INTEGER NOT NULL,
  sprint_length_weeks INTEGER NOT NULL,
  source              TEXT    NOT NULL,              -- 'ai' | 'rules'
  fallback_reason     TEXT,
  status              TEXT    NOT NULL DEFAULT 'new', -- new | in_review | approved | archived
  risk_level          TEXT    NOT NULL,
  risk_score          INTEGER NOT NULL,
  story_count         INTEGER NOT NULL,
  task_count          INTEGER NOT NULL,
  total_points        INTEGER NOT NULL,
  sprint_count        INTEGER NOT NULL,
  processing_ms       INTEGER NOT NULL,
  prd_json            TEXT    NOT NULL,
  stories_json        TEXT    NOT NULL,
  risk_json           TEXT    NOT NULL,
  summary_json        TEXT    NOT NULL,
  pipeline_json       TEXT    NOT NULL,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflows_created ON workflows(created_at);

CREATE TABLE IF NOT EXISTS tasks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id      INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  task_key         TEXT    NOT NULL,   -- T-1, T-2 …
  story_key        TEXT    NOT NULL,   -- US-1 …
  title            TEXT    NOT NULL,
  description      TEXT,
  type             TEXT    NOT NULL,
  priority_level   TEXT    NOT NULL,   -- P0..P3
  priority_score   INTEGER NOT NULL,
  priority_reasons TEXT    NOT NULL,   -- JSON array
  effort_points    INTEGER NOT NULL,
  effort_hours     INTEGER NOT NULL,
  effort_reasons   TEXT    NOT NULL,   -- JSON array
  depends_on       TEXT    NOT NULL,   -- JSON array of task_keys
  sprint_number    INTEGER NOT NULL,
  sprint_position  INTEGER NOT NULL DEFAULT 0  -- order inside the sprint (dependency-safe)
);
CREATE INDEX IF NOT EXISTS idx_tasks_workflow ON tasks(workflow_id);

CREATE TABLE IF NOT EXISTS sprints (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  number      INTEGER NOT NULL,
  name        TEXT    NOT NULL,
  goal        TEXT,
  points      INTEGER NOT NULL,
  capacity    INTEGER NOT NULL,
  utilization INTEGER NOT NULL,
  start_week  INTEGER NOT NULL,
  end_week    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sprints_workflow ON sprints(workflow_id);

CREATE TABLE IF NOT EXISTS activity_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id INTEGER,
  level       TEXT NOT NULL,   -- info | warn | error
  event       TEXT NOT NULL,   -- workflow.created, generation.fallback, …
  message     TEXT NOT NULL,
  meta_json   TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_created ON activity_logs(created_at);
`;

const STATUSES = ['new', 'in_review', 'approved', 'archived'];

let conn = null;

function init(file = config.dbPath) {
  conn = openDatabase(file);
  conn.db.exec(SCHEMA);
  return conn.driver;
}

function db() {
  if (!conn) init();
  return conn.db;
}

const now = () => new Date().toISOString();
const json = (v) => JSON.stringify(v ?? null);
const parse = (v, fallback = null) => {
  try {
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
};

function transaction(fn) {
  db().exec('BEGIN');
  try {
    const out = fn();
    db().exec('COMMIT');
    return out;
  } catch (err) {
    db().exec('ROLLBACK');
    throw err;
  }
}

// ---------- Workflows ----------
function saveWorkflow(wf, processingMs) {
  return transaction(() => {
    const ts = wf.createdAt || now();
    const info = db()
      .prepare(
        `INSERT INTO workflows (title, feature_idea, context, business_priority, sprint_capacity, sprint_length_weeks,
          source, fallback_reason, risk_level, risk_score, story_count, task_count, total_points, sprint_count,
          processing_ms, prd_json, stories_json, risk_json, summary_json, pipeline_json, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        wf.prd.title, wf.input.featureIdea, wf.input.context, wf.input.businessPriority, wf.input.sprintCapacity,
        wf.input.sprintLengthWeeks, wf.source, wf.fallbackReason, wf.risk.level, wf.risk.score, wf.summary.storyCount,
        wf.summary.taskCount, wf.summary.totalPoints, wf.summary.sprintCount, processingMs, json(wf.prd), json(wf.stories),
        json(wf.risk), json(wf.summary), json(wf.pipeline), ts, ts
      );
    const id = Number(info.lastInsertRowid);

    const insTask = db().prepare(
      `INSERT INTO tasks (workflow_id, task_key, story_key, title, description, type, priority_level, priority_score,
        priority_reasons, effort_points, effort_hours, effort_reasons, depends_on, sprint_number, sprint_position)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    const position = {};
    wf.sprints.forEach((s) => s.taskIds.forEach((tid, i) => (position[tid] = i)));
    for (const t of wf.tasks) {
      insTask.run(id, t.id, t.storyId, t.title, t.description, t.type, t.priority.level, t.priority.score,
        json(t.priority.reasons), t.effort.points, t.effort.hours, json(t.effort.reasons), json(t.dependsOn), t.sprint,
        position[t.id] ?? 0);
    }
    const insSprint = db().prepare(
      `INSERT INTO sprints (workflow_id, number, name, goal, points, capacity, utilization, start_week, end_week)
       VALUES (?,?,?,?,?,?,?,?,?)`
    );
    for (const s of wf.sprints) insSprint.run(id, s.number, s.name, s.goal, s.points, s.capacity, s.utilization, s.startWeek, s.endWeek);
    return id;
  });
}

function getWorkflow(id) {
  const w = db().prepare('SELECT * FROM workflows WHERE id = ?').get(Number(id));
  if (!w) return null;
  const tasks = db().prepare('SELECT * FROM tasks WHERE workflow_id = ? ORDER BY id').all(w.id);
  const sprints = db().prepare('SELECT * FROM sprints WHERE workflow_id = ? ORDER BY number').all(w.id);
  return {
    id: w.id,
    createdAt: w.created_at,
    updatedAt: w.updated_at,
    status: w.status,
    source: w.source,
    fallbackReason: w.fallback_reason,
    processingMs: w.processing_ms,
    input: {
      featureIdea: w.feature_idea,
      context: w.context,
      businessPriority: w.business_priority,
      sprintCapacity: w.sprint_capacity,
      sprintLengthWeeks: w.sprint_length_weeks,
    },
    prd: parse(w.prd_json, {}),
    stories: parse(w.stories_json, []),
    tasks: tasks.map((t) => ({
      id: t.task_key,
      storyId: t.story_key,
      title: t.title,
      description: t.description,
      type: t.type,
      priority: { level: t.priority_level, score: t.priority_score, reasons: parse(t.priority_reasons, []) },
      effort: { points: t.effort_points, hours: t.effort_hours, reasons: parse(t.effort_reasons, []) },
      dependsOn: parse(t.depends_on, []),
      sprint: t.sprint_number,
    })),
    sprints: sprints.map((s) => {
      const taskIds = tasks.filter((t) => t.sprint_number === s.number).sort((a, b) => a.sprint_position - b.sprint_position).map((t) => t.task_key);
      return { number: s.number, name: s.name, goal: s.goal, points: s.points, capacity: s.capacity, utilization: s.utilization, taskIds, startWeek: s.start_week, endWeek: s.end_week };
    }),
    risk: parse(w.risk_json, { level: w.risk_level, score: w.risk_score, factors: [] }),
    summary: parse(w.summary_json, {}),
    pipeline: parse(w.pipeline_json, []),
  };
}

function listWorkflows({ q = '', status = '', risk = '', source = '', limit = 25, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (q) {
    where.push('(title LIKE ? OR feature_idea LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  for (const [column, value] of [['status', status], ['risk_level', risk], ['source', source]]) {
    if (value) {
      where.push(`${column} = ?`);
      params.push(value);
    }
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db().prepare(`SELECT COUNT(*) AS n FROM workflows ${clause}`).get(...params).n;
  const rows = db()
    .prepare(
      `SELECT id, title, feature_idea, business_priority, source, status, risk_level, risk_score, story_count, task_count,
              total_points, sprint_count, processing_ms, created_at
         FROM workflows ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, Math.min(100, Number(limit) || 25), Number(offset) || 0);
  return {
    total: Number(total),
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      featureIdea: r.feature_idea,
      businessPriority: r.business_priority,
      source: r.source,
      status: r.status,
      riskLevel: r.risk_level,
      riskScore: r.risk_score,
      storyCount: r.story_count,
      taskCount: r.task_count,
      totalPoints: r.total_points,
      sprintCount: r.sprint_count,
      processingMs: r.processing_ms,
      createdAt: r.created_at,
    })),
  };
}

function updateWorkflowStatus(id, status) {
  if (!STATUSES.includes(status)) throw Object.assign(new Error(`status must be one of ${STATUSES.join(', ')}`), { status: 400 });
  const info = db().prepare('UPDATE workflows SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), Number(id));
  return Number(info.changes) > 0;
}

function deleteWorkflow(id) {
  const info = db().prepare('DELETE FROM workflows WHERE id = ?').run(Number(id));
  return Number(info.changes) > 0;
}

// ---------- Activity log ----------
function logActivity({ workflowId = null, level = 'info', event, message, meta = null }) {
  try {
    db()
      .prepare('INSERT INTO activity_logs (workflow_id, level, event, message, meta_json, created_at) VALUES (?,?,?,?,?,?)')
      .run(workflowId, level, event, message, meta ? json(meta) : null, now());
  } catch (err) {
    console.error('[log] failed to write activity log:', err.message);
  }
}

function listActivity({ limit = 50, level = '' } = {}) {
  const clause = level ? 'WHERE level = ?' : '';
  const params = level ? [level] : [];
  return db()
    .prepare(`SELECT * FROM activity_logs ${clause} ORDER BY id DESC LIMIT ?`)
    .all(...params, Math.min(200, Number(limit) || 50))
    .map((r) => ({ id: r.id, workflowId: r.workflow_id, level: r.level, event: r.event, message: r.message, meta: parse(r.meta_json), createdAt: r.created_at }));
}

module.exports = {
  init, db, saveWorkflow, getWorkflow, listWorkflows, updateWorkflowStatus, deleteWorkflow, logActivity, listActivity, STATUSES,
  driver: () => conn?.driver,
};
