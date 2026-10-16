// Unit tests for the smart logic layer and generators. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../src/generator/ruleGenerator');
const { normalise } = require('../src/generator/aiGenerator');
const { applyLogic } = require('../src/logic');
const { estimateEffort, FIB } = require('../src/logic/effort');
const { scorePriority } = require('../src/logic/priority');
const { validateWorkflowInput } = require('../src/validation');

const IDEAS = [
  'Let customers book salon appointments online, pay a deposit by card, and receive SMS reminders 24 hours before the visit.',
  'Add real-time team chat with channels, direct messages, file upload, message search and push notifications for mentions.',
  'Employees can submit expense reports with receipt photos, managers approve or reject them, and finance can export to CSV.',
  'We need a way to track inventory levels across warehouses',
];

function plan(idea, overrides = {}) {
  const input = validateWorkflowInput({ featureIdea: idea, ...overrides });
  const draft = rules.generate(input);
  return { input, draft, ...applyLogic(draft, input) };
}

test('input validation rejects short ideas and bad capacity', () => {
  assert.throws(() => validateWorkflowInput({ featureIdea: 'too short' }), /at least 20/);
  assert.throws(() => validateWorkflowInput({ featureIdea: IDEAS[0], sprintCapacity: 2 }), /between 5 and 100/);
  assert.equal(validateWorkflowInput({ featureIdea: IDEAS[0], businessPriority: 'bogus' }).businessPriority, 'medium');
});

test('rule generator detects modules and links every task to a story', () => {
  const d = rules.generate({ featureIdea: IDEAS[0] });
  assert.deepEqual(d.detectedModules.slice(0, 3), ['booking', 'payments', 'notifications']);
  const storyIds = new Set(d.stories.map((s) => s.id));
  d.tasks.forEach((t) => assert.ok(storyIds.has(t.storyId), `${t.id} has unknown story`));
});

test('effort is always a Fibonacci number and complexity raises it', () => {
  const simple = estimateEffort({ type: 'frontend', title: 'Settings page', description: '' });
  const complex = estimateEffort({ type: 'backend', title: 'Payment webhooks with retries', description: 'Real-time reconciliation' });
  assert.ok(FIB.includes(simple.points) && FIB.includes(complex.points));
  assert.ok(complex.points > simple.points);
});

test('priority levels follow the score thresholds', () => {
  const task = { type: 'database', title: 'Schema', description: '', effort: { points: 3 } };
  const high = scorePriority(task, { story: { moscow: 'Must' }, businessPriority: 'critical', unblocks: 10 });
  const low = scorePriority({ ...task, type: 'data' }, { story: { moscow: 'Could' }, businessPriority: 'low', unblocks: 0 });
  assert.equal(high.level, 'P0');
  assert.equal(low.level, 'P3');
});

for (const idea of IDEAS) {
  test(`plan is consistent: ${idea.slice(0, 40)}…`, () => {
    const p = plan(idea, { sprintCapacity: 15 });
    const byId = Object.fromEntries(p.tasks.map((t) => [t.id, t]));

    // Dependencies reference real tasks and never point to a later sprint
    for (const t of p.tasks) {
      for (const d of t.dependsOn) {
        assert.ok(byId[d], `${t.id} depends on missing ${d}`);
        assert.ok(byId[d].sprint <= t.sprint, `${t.id} (S${t.sprint}) scheduled before dependency ${d} (S${byId[d].sprint})`);
      }
    }
    // Capacity respected unless a single task is larger than a sprint
    for (const s of p.sprints) {
      if (s.taskIds.length > 1) assert.ok(s.points <= s.capacity, `${s.name} over capacity`);
    }
    // Every task scheduled exactly once
    const scheduled = p.sprints.flatMap((s) => s.taskIds);
    assert.equal(scheduled.length, p.tasks.length);
    assert.equal(new Set(scheduled).size, p.tasks.length);
    // Critical path is a valid chain
    const cp = p.summary.criticalPath;
    for (let i = 1; i < cp.length; i++) assert.ok(byId[cp[i]].dependsOn.includes(cp[i - 1]));
  });
}

test('risk flags payments and scales with scope', () => {
  const pay = plan(IDEAS[0]);
  assert.ok(pay.risk.factors.some((f) => f.factor === 'Handles payments'));
  const small = plan(IDEAS[3]);
  assert.ok(small.risk.score < pay.risk.score);
});

test('AI output is normalised: ids re-keyed, unknown types guessed, story links repaired', () => {
  const d = normalise(
    {
      prd: { title: 'Thing' },
      stories: [{ id: 'S-a', action: 'to do a', moscow: 'Must' }, { id: 'S-b', action: 'do b', moscow: 'Maybe' }],
      tasks: [
        { title: 'Create schema', storyId: 'S-b' },
        { title: 'Build UI', type: 'FRONTEND', storyId: 'nope' },
        { title: 'Write tests', type: 'testing' },
        { title: 'Deploy', type: 'devops' },
      ],
    },
    { featureIdea: 'x' }
  );
  assert.deepEqual(d.stories.map((s) => s.id), ['US-1', 'US-2']);
  assert.equal(d.stories[0].action, 'do a');
  assert.equal(d.stories[1].moscow, 'Should');
  assert.deepEqual(d.tasks.map((t) => t.type), ['database', 'frontend', 'qa', 'devops']);
  assert.equal(d.tasks[0].storyId, 'US-2');
  assert.equal(d.tasks[1].storyId, 'US-1');
});
