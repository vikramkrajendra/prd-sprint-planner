// Orchestrates the end-to-end workflow:
// input → generation (AI / rules) → smart logic layer → database → output, recording a timing trace for each step.
const { validateWorkflowInput } = require('./validation');
const { generateDraft } = require('./generator');
const { applyLogic } = require('./logic');
const store = require('./db');

async function timed(trace, step, fn) {
  const t0 = Date.now();
  const out = await fn();
  trace.push({ step, ms: Date.now() - t0, status: 'ok', ...(out?.__trace || {}) });
  return out;
}

async function runWorkflow(body, { receivedAt = Date.now() } = {}) {
  const trace = [];
  const input = await timed(trace, 'input', () => validateWorkflowInput(body));
  trace.push({ step: 'api', ms: Date.now() - receivedAt, status: 'ok' });

  const draft = await timed(trace, 'generation', async () => {
    const d = await generateDraft(input);
    d.__trace = {
      status: d.fallbackReason && input.useAI ? 'fallback' : 'ok',
      detail: d.source === 'ai' ? 'OpenAI' : 'rule-based',
    };
    return d;
  });
  delete draft.__trace;

  const plan = await timed(trace, 'logic', () => {
    const p = applyLogic(draft, input);
    p.__trace = { detail: `${p.summary.dependencyCount} deps · ${p.summary.sprintCount} sprints` };
    return p;
  });
  delete plan.__trace;

  const result = {
    id: null,
    createdAt: new Date().toISOString(),
    source: draft.source,
    fallbackReason: draft.fallbackReason,
    input,
    prd: draft.prd,
    stories: draft.stories,
    tasks: plan.tasks,
    sprints: plan.sprints,
    risk: plan.risk,
    summary: plan.summary,
  };
  // Storage: persist the workflow, its tasks and sprints, plus an activity log entry.
  const t0 = Date.now();
  trace.push({ step: 'storage', ms: 0, status: 'ok' }, { step: 'output', ms: 0, status: 'ok' });
  result.pipeline = trace;
  result.id = store.saveWorkflow(result, Date.now() - receivedAt);
  trace.find((t) => t.step === 'storage').ms = Date.now() - t0;
  result.processingMs = Date.now() - receivedAt;
  result.status = 'new';

  if (draft.fallbackReason && input.useAI) {
    store.logActivity({ workflowId: result.id, level: 'warn', event: 'generation.fallback', message: draft.fallbackReason });
  }
  store.logActivity({
    workflowId: result.id,
    event: 'workflow.created',
    message: `“${result.prd.title}” — ${plan.summary.taskCount} tasks, ${plan.summary.sprintCount} sprints, ${plan.risk.level} risk`,
    meta: { source: draft.source, ms: result.processingMs },
  });
  return result;
}

module.exports = { runWorkflow };
