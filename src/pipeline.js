// Orchestrates the end-to-end workflow:
// input → generation (AI / rules) → smart logic layer → output, recording a timing trace for each step.
const { validateWorkflowInput } = require('./validation');
const { generateDraft } = require('./generator');
const { applyLogic } = require('./logic');

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
  trace.push({ step: 'output', ms: 0, status: 'ok' });
  result.pipeline = trace;
  return result;
}

module.exports = { runWorkflow };
