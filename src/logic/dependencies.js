// Dependency detection: infers which tasks must finish before others using
// layer rules (design → data → integration → API → UI → QA → release),
// cross-story foundation rules, then removes redundant (transitive) edges and
// guarantees the graph is acyclic.

// Which task types a task of a given type waits for, within the same user story.
const SAME_STORY = {
  design: [],
  database: [],
  integration: ['database'],
  backend: ['database', 'integration'],
  data: ['backend'],
  frontend: ['backend', 'integration'],
  qa: ['frontend', 'backend', 'integration'],
  devops: [],
};

function detectDependencies(tasks, stories) {
  const coreStory = stories[0]?.id;
  const deps = new Map(tasks.map((t) => [t.id, new Set()]));
  const why = new Map(tasks.map((t) => [t.id, []]));
  const link = (from, to, reason) => {
    if (from.id === to.id) return;
    if (!deps.get(from.id).has(to.id)) {
      deps.get(from.id).add(to.id);
      why.get(from.id).push(`${to.id}: ${reason}`);
    }
  };

  const designTasks = tasks.filter((t) => t.type === 'design');
  const coreDb = tasks.filter((t) => t.type === 'database' && t.storyId === coreStory);
  const coreApi = tasks.filter((t) => t.type === 'backend' && t.storyId === coreStory);
  const qaTasks = tasks.filter((t) => t.type === 'qa');

  for (const t of tasks) {
    // 1. Layer rule inside the same story
    for (const other of tasks) {
      if (other.storyId === t.storyId && SAME_STORY[t.type]?.includes(other.type)) link(t, other, `${other.type} before ${t.type}`);
    }
    // 2. UI work waits for UX design
    if (t.type === 'frontend') designTasks.forEach((d) => link(t, d, 'designs needed for UI'));
    // 3. Feature-module data and API work builds on the core data model and API
    if (t.storyId !== coreStory) {
      if (['database', 'backend', 'integration'].includes(t.type)) coreDb.forEach((d) => link(t, d, 'extends core data model'));
      if (t.type === 'backend') coreApi.forEach((d) => link(t, d, 'extends core API'));
    }
    // 4. Release waits for all testing
    if (t.type === 'devops' && /release|launch|rollout|deploy/i.test(t.title)) qaTasks.forEach((q) => link(t, q, 'release after testing'));
    // 5. Core end-to-end tests cover every story's UI
    if (t.type === 'qa' && t.storyId === coreStory && /end-to-end|e2e|automated/i.test(t.title)) {
      tasks.filter((o) => o.type === 'frontend').forEach((o) => link(t, o, 'tests cover UI'));
    }
  }

  removeCycles(tasks, deps, why);
  transitiveReduction(tasks, deps);

  return tasks.map((t) => ({
    id: t.id,
    dependsOn: [...deps.get(t.id)].sort(byId),
    reasons: why.get(t.id).filter((r) => deps.get(t.id).has(r.split(':')[0])),
  }));
}

const byId = (a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]);

// Depth-first search; any back edge (cycle) is dropped.
function removeCycles(tasks, deps) {
  const state = new Map(); // 1 = visiting, 2 = done
  const visit = (id) => {
    state.set(id, 1);
    for (const d of [...deps.get(id)]) {
      if (state.get(d) === 1) deps.get(id).delete(d);
      else if (!state.get(d)) visit(d);
    }
    state.set(id, 2);
  };
  tasks.forEach((t) => !state.get(t.id) && visit(t.id));
}

// Remove edge A→C when A→B→…→C already exists, so lists show only direct prerequisites.
function transitiveReduction(tasks, deps) {
  const reach = new Map();
  const reachable = (id) => {
    if (reach.has(id)) return reach.get(id);
    const set = new Set();
    for (const d of deps.get(id)) {
      set.add(d);
      reachable(d).forEach((x) => set.add(x));
    }
    reach.set(id, set);
    return set;
  };
  tasks.forEach((t) => reachable(t.id));
  for (const t of tasks) {
    const direct = deps.get(t.id);
    for (const d of [...direct]) {
      for (const other of direct) {
        if (other !== d && reach.get(other).has(d)) {
          direct.delete(d);
          break;
        }
      }
    }
  }
}

// Topological order (Kahn). Among ready tasks, `rank` decides who goes first.
function topoSort(tasks, rank = () => 0) {
  const indeg = new Map(tasks.map((t) => [t.id, t.dependsOn.length]));
  const dependents = new Map(tasks.map((t) => [t.id, []]));
  tasks.forEach((t) => t.dependsOn.forEach((d) => dependents.get(d).push(t.id)));
  const byKey = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const ready = tasks.filter((t) => indeg.get(t.id) === 0);
  const order = [];
  while (ready.length) {
    ready.sort((a, b) => rank(b) - rank(a) || byId(a.id, b.id));
    const t = ready.shift();
    order.push(t);
    for (const n of dependents.get(t.id)) {
      indeg.set(n, indeg.get(n) - 1);
      if (indeg.get(n) === 0) ready.push(byKey[n]);
    }
  }
  return order;
}

// Number of tasks that transitively depend on each task (how much it unblocks).
function countDependents(tasks) {
  const dependents = new Map(tasks.map((t) => [t.id, []]));
  tasks.forEach((t) => t.dependsOn.forEach((d) => dependents.get(d).push(t.id)));
  const memo = new Map();
  const walk = (id) => {
    if (memo.has(id)) return memo.get(id);
    const set = new Set();
    for (const n of dependents.get(id)) {
      set.add(n);
      walk(n).forEach((x) => set.add(x));
    }
    memo.set(id, set);
    return set;
  };
  return Object.fromEntries(tasks.map((t) => [t.id, walk(t.id).size]));
}

// Longest chain of dependent work, weighted by story points.
function criticalPath(tasks) {
  const order = topoSort(tasks);
  const best = new Map();
  const prev = new Map();
  for (const t of order) {
    let base = 0;
    let from = null;
    for (const d of t.dependsOn) {
      if (best.get(d) > base) {
        base = best.get(d);
        from = d;
      }
    }
    best.set(t.id, base + t.effort.points);
    prev.set(t.id, from);
  }
  let end = null;
  for (const [id, v] of best) if (end === null || v > best.get(end)) end = id;
  const path = [];
  for (let cur = end; cur; cur = prev.get(cur)) path.unshift(cur);
  return { path, points: end ? best.get(end) : 0 };
}

module.exports = { detectDependencies, topoSort, countDependents, criticalPath };
