// Admin API: monitoring metrics, workflow management and activity logs.
// If ADMIN_KEY is set, every admin request must send it in the `x-admin-key` header.
const config = require('../config');
const { readBody } = require('../http');
const store = require('../db');

const startedAt = Date.now();

function requireAdmin(req) {
  if (config.adminKey && req.headers['x-admin-key'] !== config.adminKey) {
    throw Object.assign(new Error('Admin key required'), { status: 401 });
  }
}

const count = (sql, ...p) => Number(store.db().prepare(sql).get(...p).n || 0);
const groupBy = (sql, ...p) => Object.fromEntries(store.db().prepare(sql).all(...p).map((r) => [r.k, Number(r.n)]));

function stats() {
  const db = store.db();
  const since = (days) => new Date(Date.now() - days * 864e5).toISOString();
  const today = new Date().toISOString().slice(0, 10);

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS workflows, COALESCE(SUM(task_count),0) AS tasks, COALESCE(SUM(total_points),0) AS points,
              COALESCE(AVG(processing_ms),0) AS avgMs, COALESCE(MAX(processing_ms),0) AS maxMs,
              COALESCE(AVG(risk_score),0) AS avgRisk, COALESCE(AVG(sprint_count),0) AS avgSprints
         FROM workflows`
    )
    .get();

  // Workflows per day for the last 14 days (zero-filled)
  const perDayRows = groupBy(`SELECT substr(created_at,1,10) AS k, COUNT(*) AS n FROM workflows WHERE created_at >= ? GROUP BY k`, since(14));
  const perDay = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    perDay.push({ date: d, count: perDayRows[d] || 0 });
  }

  return {
    totals: {
      workflows: Number(totals.workflows),
      tasks: Number(totals.tasks),
      storyPoints: Number(totals.points),
      today: count(`SELECT COUNT(*) AS n FROM workflows WHERE substr(created_at,1,10) = ?`, today),
      last7Days: count(`SELECT COUNT(*) AS n FROM workflows WHERE created_at >= ?`, since(7)),
      avgProcessingMs: Math.round(totals.avgMs),
      maxProcessingMs: Number(totals.maxMs),
      avgRiskScore: Math.round(totals.avgRisk),
      avgSprints: Math.round(totals.avgSprints * 10) / 10,
      errors24h: count(`SELECT COUNT(*) AS n FROM activity_logs WHERE level = 'error' AND created_at >= ?`, since(1)),
      fallbacks: count(`SELECT COUNT(*) AS n FROM activity_logs WHERE event = 'generation.fallback'`),
    },
    bySource: groupBy(`SELECT source AS k, COUNT(*) AS n FROM workflows GROUP BY source`),
    byRisk: groupBy(`SELECT risk_level AS k, COUNT(*) AS n FROM workflows GROUP BY risk_level`),
    byStatus: groupBy(`SELECT status AS k, COUNT(*) AS n FROM workflows GROUP BY status`),
    byBusinessPriority: groupBy(`SELECT business_priority AS k, COUNT(*) AS n FROM workflows GROUP BY business_priority`),
    tasksByPriority: groupBy(`SELECT priority_level AS k, COUNT(*) AS n FROM tasks GROUP BY priority_level`),
    tasksByType: groupBy(`SELECT type AS k, COUNT(*) AS n FROM tasks GROUP BY type ORDER BY n DESC`),
    perDay,
  };
}

function system() {
  const mem = process.memoryUsage();
  return {
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    node: process.version,
    dbDriver: store.driver(),
    aiEnabled: Boolean(config.openaiKey),
    aiModel: config.openaiKey ? config.openaiModel : null,
    adminProtected: Boolean(config.adminKey),
    memoryMb: Math.round(mem.rss / 1048576),
  };
}

function register(router) {
  router.get('/api/admin/stats', ({ req }) => (requireAdmin(req), { ...stats(), system: system() }));

  router.get('/api/admin/workflows', ({ req, query }) => {
    requireAdmin(req);
    return store.listWorkflows(query);
  });

  router.patch('/api/admin/workflows/:id', async ({ req, params }) => {
    requireAdmin(req);
    const { status } = await readBody(req);
    if (!store.updateWorkflowStatus(params.id, status)) throw Object.assign(new Error('Workflow not found'), { status: 404 });
    store.logActivity({ workflowId: Number(params.id), event: 'workflow.status', message: `Workflow #${params.id} marked ${status}` });
    return { ok: true, id: Number(params.id), status };
  });

  router.delete('/api/admin/workflows/:id', ({ req, params }) => {
    requireAdmin(req);
    if (!store.deleteWorkflow(params.id)) throw Object.assign(new Error('Workflow not found'), { status: 404 });
    store.logActivity({ level: 'warn', event: 'workflow.deleted', message: `Workflow #${params.id} deleted by admin` });
    return { ok: true };
  });

  router.get('/api/admin/activity', ({ req, query }) => {
    requireAdmin(req);
    return { items: store.listActivity({ limit: query.limit, level: query.level }) };
  });
}

module.exports = { register };
