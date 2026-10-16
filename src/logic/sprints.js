// Sprint allocation: greedy capacity-based planning.
// Tasks are taken in dependency-safe order (highest priority first among ready tasks)
// and placed in the earliest sprint that (a) has capacity and (b) is not before any
// prerequisite. Large prerequisites (≥5 points) must finish in an earlier sprint.
const { topoSort } = require('./dependencies');

const LARGE_PREREQ = 5;

function allocateSprints(tasks, stories, { capacity, sprintLengthWeeks }) {
  const order = topoSort(tasks, (t) => t.priority.score);
  const sprintOf = {};
  const load = []; // load[i] = points in sprint i+1
  const overflow = [];

  for (const t of order) {
    let earliest = 1;
    for (const d of t.dependsOn) {
      const dep = tasks.find((x) => x.id === d);
      const after = sprintOf[d] + (dep.effort.points >= LARGE_PREREQ ? 1 : 0);
      earliest = Math.max(earliest, after);
    }
    let s = earliest;
    if (t.effort.points > capacity) {
      // Too big for any sprint: give it an empty sprint of its own and flag it.
      while ((load[s - 1] || 0) > 0) s++;
      overflow.push(t.id);
    } else {
      while ((load[s - 1] || 0) + t.effort.points > capacity) s++;
    }
    load[s - 1] = (load[s - 1] || 0) + t.effort.points;
    sprintOf[t.id] = s;
  }

  const count = load.length;
  const storyById = Object.fromEntries(stories.map((s) => [s.id, s]));
  const sprints = [];
  for (let n = 1; n <= count; n++) {
    const inSprint = order.filter((t) => sprintOf[t.id] === n);
    if (!inSprint.length) continue;
    const points = inSprint.reduce((a, t) => a + t.effort.points, 0);
    sprints.push({
      number: n,
      name: `Sprint ${n}`,
      goal: sprintGoal(inSprint, storyById, n),
      points,
      capacity,
      utilization: Math.round((points / capacity) * 100),
      taskIds: inSprint.map((t) => t.id),
      startWeek: (n - 1) * sprintLengthWeeks + 1,
      endWeek: n * sprintLengthWeeks,
    });
  }
  // Renumber in case a gap was left
  sprints.forEach((s, i) => {
    if (s.number !== i + 1) {
      s.taskIds.forEach((id) => (sprintOf[id] = i + 1));
      s.number = i + 1;
      s.name = `Sprint ${i + 1}`;
      s.startWeek = i * sprintLengthWeeks + 1;
      s.endWeek = (i + 1) * sprintLengthWeeks;
    }
  });

  return { sprintOf, sprints, overflow };
}

function sprintGoal(tasks, storyById, n) {
  const pointsByStory = {};
  tasks.forEach((t) => (pointsByStory[t.storyId] = (pointsByStory[t.storyId] || 0) + t.effort.points));
  const top = Object.entries(pointsByStory).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([id]) => storyById[id]?.action).filter(Boolean);
  const foundational = tasks.filter((t) => ['design', 'database'].includes(t.type)).length >= tasks.length / 2;
  const releasing = tasks.some((t) => t.type === 'devops' && /release|launch|rollout/i.test(t.title));
  let goal = foundational && n === 1 ? 'Lay foundations (UX, data model) for: ' : 'Deliver: ';
  goal += top.join(' + ');
  if (releasing) goal += ' — then release behind a feature flag';
  return goal;
}

module.exports = { allocateSprints };
