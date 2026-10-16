// Smart Logic Layer: turns a generated draft (PRD, stories, tasks) into an
// execution plan. Runs deterministically after generation, whether the draft
// came from the AI or from rules:
//   1. effort estimation   2. dependency detection   3. priority scoring
//   4. sprint allocation   5. risk assessment        6. summary + critical path
const config = require('../config');
const { estimateEffort } = require('./effort');
const { detectDependencies, countDependents, criticalPath } = require('./dependencies');
const { scorePriority } = require('./priority');
const { allocateSprints } = require('./sprints');
const { assessRisk } = require('./risk');

function applyLogic(draft, input) {
  const storyById = Object.fromEntries(draft.stories.map((s) => [s.id, s]));

  // 1. Effort
  let tasks = draft.tasks.map((t) => ({ ...t, effort: estimateEffort(t) }));

  // 2. Dependencies
  const deps = Object.fromEntries(detectDependencies(tasks, draft.stories).map((d) => [d.id, d]));
  tasks = tasks.map((t) => ({ ...t, dependsOn: deps[t.id].dependsOn, dependencyReasons: deps[t.id].reasons }));

  // 3. Priority
  const unblocks = countDependents(tasks);
  tasks = tasks.map((t) => ({
    ...t,
    priority: scorePriority(t, { story: storyById[t.storyId], businessPriority: input.businessPriority, unblocks: unblocks[t.id] }),
  }));

  // 4. Sprint allocation
  const { sprintOf, sprints, overflow } = allocateSprints(tasks, draft.stories, {
    capacity: input.sprintCapacity,
    sprintLengthWeeks: input.sprintLengthWeeks,
  });
  tasks = tasks.map((t) => ({ ...t, sprint: sprintOf[t.id] }));

  // 5. Risk
  const critical = criticalPath(tasks);
  const risk = assessRisk({ input, tasks, sprints, critical, overflow });

  // 6. Summary
  const totalPoints = tasks.reduce((a, t) => a + t.effort.points, 0);
  const summary = {
    storyCount: draft.stories.length,
    taskCount: tasks.length,
    totalPoints,
    totalHours: totalPoints * config.defaults.hoursPerPoint,
    sprintCount: sprints.length,
    durationWeeks: sprints.length * input.sprintLengthWeeks,
    criticalPath: critical.path,
    criticalPathPoints: critical.points,
    dependencyCount: tasks.reduce((a, t) => a + t.dependsOn.length, 0),
    overflowTasks: overflow,
  };

  return { tasks, sprints, risk, summary };
}

module.exports = { applyLogic };
