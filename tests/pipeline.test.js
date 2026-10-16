// Integration tests: full pipeline (input → generation → logic → database → output)
// using an in-memory database and a mocked OpenAI API.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
const config = require('../src/config');
config.dbPath = ':memory:';
const store = require('../src/db');
const { runWorkflow } = require('../src/pipeline');

store.init(':memory:');

const IDEA = 'Let customers book salon appointments online, pay a deposit by card, and receive SMS reminders.';

const FAKE_AI = {
  prd: {
    title: 'Online Booking', summary: 'Self-service booking.', problem: 'Phone booking is slow.',
    goals: ['Reduce no-shows'], nonGoals: ['Native apps'], personas: [{ name: 'Customer', need: 'Book quickly' }],
    requirements: { functional: ['Book a slot'], nonFunctional: ['Fast'] }, metrics: ['Online booking share'],
    assumptions: [], openQuestions: [],
  },
  stories: [
    { id: 'US-1', persona: 'Customer', action: 'book a slot', benefit: 'I save time', acceptance: ['Slot is reserved'], moscow: 'Must' },
    { id: 'US-2', persona: 'Customer', action: 'pay a deposit', benefit: 'my booking is confirmed', acceptance: ['Receipt sent'], moscow: 'Must' },
  ],
  tasks: [
    { id: 'T-1', title: 'Booking schema', description: 'Tables for slots', type: 'database', storyId: 'US-1' },
    { id: 'T-2', title: 'Booking API', description: 'Create bookings', type: 'backend', storyId: 'US-1' },
    { id: 'T-3', title: 'Booking UI', description: 'Calendar picker', type: 'frontend', storyId: 'US-1' },
    { id: 'T-4', title: 'Payment provider integration', description: 'Hosted checkout', type: 'integration', storyId: 'US-2' },
    { id: 'T-5', title: 'Checkout UI', description: 'Payment form', type: 'frontend', storyId: 'US-2' },
    { id: 'T-6', title: 'End-to-end tests', description: 'Cover booking and payment', type: 'qa', storyId: 'US-1' },
  ],
};

function mockFetch(handler) {
  const original = global.fetch;
  global.fetch = handler;
  return () => (global.fetch = original);
}

test('rule-based run is stored and can be read back identically', async () => {
  config.openaiKey = '';
  const wf = await runWorkflow({ featureIdea: IDEA, businessPriority: 'high' });
  assert.equal(wf.source, 'rules');
  assert.ok(wf.id > 0);
  assert.deepEqual(wf.pipeline.map((s) => s.step), ['input', 'api', 'generation', 'logic', 'storage', 'output']);
  const saved = store.getWorkflow(wf.id);
  assert.deepEqual(saved.sprints, wf.sprints);
  assert.deepEqual(saved.tasks.map((t) => [t.id, t.sprint, t.priority.level, t.effort.points]), wf.tasks.map((t) => [t.id, t.sprint, t.priority.level, t.effort.points]));
});

test('AI path: model output goes through the logic layer', async () => {
  config.openaiKey = 'test-key';
  const restore = mockFetch(async (url, opts) => {
    assert.match(url, /openai\.com/);
    assert.equal(JSON.parse(opts.body).response_format.type, 'json_object');
    return { ok: true, json: async () => ({ model: 'gpt-test', choices: [{ message: { content: JSON.stringify(FAKE_AI) } }] }) };
  });
  try {
    const wf = await runWorkflow({ featureIdea: IDEA });
    assert.equal(wf.source, 'ai');
    assert.equal(wf.prd.title, 'Online Booking');
    // Logic layer added effort, priority, dependencies and sprints
    const ui = wf.tasks.find((t) => t.title === 'Booking UI');
    assert.ok(ui.dependsOn.includes('T-2'), 'UI should depend on its API');
    assert.ok(wf.tasks.every((t) => t.sprint >= 1 && t.priority.level && t.effort.points));
    assert.ok(wf.risk.factors.some((f) => f.factor === 'Handles payments'));
  } finally {
    restore();
    config.openaiKey = '';
  }
});

test('AI failure falls back to rules and logs a warning', async () => {
  config.openaiKey = 'test-key';
  const restore = mockFetch(async () => ({ ok: false, status: 429, text: async () => 'rate limited' }));
  try {
    const wf = await runWorkflow({ featureIdea: IDEA });
    assert.equal(wf.source, 'rules');
    assert.match(wf.fallbackReason, /429/);
    assert.equal(wf.pipeline.find((s) => s.step === 'generation').status, 'fallback');
    const logs = store.listActivity({ level: 'warn' });
    assert.ok(logs.some((l) => l.event === 'generation.fallback' && l.workflowId === wf.id));
  } finally {
    restore();
    config.openaiKey = '';
  }
});

test('history search, status update and delete', async () => {
  const { items } = store.listWorkflows({ q: 'salon' });
  assert.ok(items.length >= 1);
  const id = items[0].id;
  assert.ok(store.updateWorkflowStatus(id, 'approved'));
  assert.equal(store.getWorkflow(id).status, 'approved');
  assert.throws(() => store.updateWorkflowStatus(id, 'nope'), /status must be/);
  assert.ok(store.deleteWorkflow(id));
  assert.equal(store.getWorkflow(id), null);
  const orphanTasks = store.db().prepare('SELECT COUNT(*) AS n FROM tasks WHERE workflow_id = ?').get(id).n;
  assert.equal(Number(orphanTasks), 0, 'tasks are deleted with their workflow');
});
