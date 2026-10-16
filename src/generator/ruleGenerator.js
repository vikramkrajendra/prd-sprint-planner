// Rule-based generator: builds a PRD, user stories and engineering tasks from a
// feature idea using keyword detection and templates. Used when no AI key is set
// or when the AI call fails, so the system always produces a result.
const { MODULES, PERSONAS, SECONDARY } = require('./modules');

const sentenceCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Modules ordered by where they are first mentioned, so the story order follows the idea.
function detectModules(text) {
  return MODULES.map((m) => ({ m, at: text.search(m.match) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.m);
}

function detectPersonas(text, modules) {
  const found = [];
  for (const [re, name, need] of PERSONAS) {
    if (new RegExp(`\\b(${re})\\b`, 'i').test(text) && !found.some((p) => p.name === name)) found.push({ name, need });
  }
  if (!found.length) found.push({ name: 'User', need: 'wants the feature to be simple and reliable' });

  const roles = { primary: found[0].name };
  for (const [role, [re, name, need]] of Object.entries(SECONDARY)) {
    const mentioned = new RegExp(`\\b(${re})\\b`, 'i').test(text);
    const needed = modules.some((m) => m.persona === role);
    if (mentioned || needed) {
      if (!found.some((p) => p.name === name)) found.push({ name, need });
      roles[role] = name;
    }
  }
  return { personas: found.slice(0, 4), roles };
}

// Extracts the core capability from the first clause of the idea.
// "Let customers book salon appointments online, ..." → action "book salon appointments online"
// "Add real-time team chat with channels"            → action "use real-time team chat with channels"
const PERSONA_WORDS = [...PERSONAS.map(([re]) => re), ...Object.values(SECONDARY).map(([re]) => re)].join('|');
function parseCore(idea) {
  let clause = idea.split(/[.,;:\n]| and (?=[a-z]+ (?:can|should|must|will)\b)/i)[0].trim();
  let isVerbPhrase = false;
  const subject = new RegExp(`^(?:let|allow|enable|help)?\\s*(?:our |the |all )?(?:${PERSONA_WORDS})\\s+(?:can |should |must |will |to |be able to )*`, 'i');
  if (subject.test(clause)) {
    clause = clause.replace(subject, '');
    isVerbPhrase = true;
  } else if (/^(we|i) (want|need)( a way)? to\s+/i.test(clause)) {
    clause = clause.replace(/^(we|i) (want|need)( a way)? to\s+/i, '');
    isVerbPhrase = true;
  } else {
    clause = clause.replace(/^(please\s+)?(add|build|create|implement|introduce|enable|support|launch|develop)\s+(an?\s+|the\s+)?/i, '');
  }
  const words = clause.split(/\s+/).filter(Boolean).slice(0, 8);
  while (words.length > 2 && /^(with|and|for|to|of|in|on|by|a|an|the|that|so)$/i.test(words.at(-1))) words.pop();
  const phrase = words.join(' ');
  const title = phrase.replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(With|And|For|To|Of|In|On|By|A|An|The)\b/g, (w, _, i) => (i === 0 ? w : w.toLowerCase()));
  return { title: title || 'New Feature', action: isVerbPhrase ? phrase.toLowerCase() : `use ${phrase.toLowerCase()}` };
}

function generate(input) {
  const idea = input.featureIdea.trim();
  const text = `${idea} ${input.context || ''}`;
  const modules = detectModules(idea);
  const { personas, roles } = detectPersonas(text, modules);
  const { title, action: coreAction } = parseCore(idea);
  const primary = roles.primary;

  // ----- User stories -----
  const stories = [];
  stories.push({
    id: 'US-1',
    persona: primary,
    action: coreAction,
    benefit: 'I can get the job done in one place without manual workarounds',
    acceptance: [
      'The main flow can be completed without assistance',
      'Validation errors are shown inline and in plain language',
      'Data entered is saved and visible after reload',
    ],
    moscow: 'Must',
  });
  // Thin ideas get a generic management story so the plan still covers a full CRUD slice.
  if (modules.length < 2) {
    stories.push({
      id: 'US-2',
      persona: primary,
      action: 'view, edit and remove the records I have created',
      benefit: 'I can keep information accurate over time',
      acceptance: ['Records are listed newest first with pagination', 'Edits are saved with a visible confirmation', 'Deleting asks for confirmation and can be undone for 10 seconds'],
      moscow: 'Should',
      module: 'manage',
    });
  }
  modules.forEach((m) => {
    stories.push({
      id: `US-${stories.length + 1}`,
      persona: roles[m.persona] || primary,
      action: m.story.action,
      benefit: m.story.benefit,
      acceptance: m.story.acceptance,
      moscow: m.moscow,
      module: m.key,
    });
  });

  // ----- Engineering tasks -----
  const tasks = [];
  const add = (t, storyId) => tasks.push({ id: `T-${tasks.length + 1}`, title: t.title, description: t.desc, type: t.type, storyId });

  add({ title: 'UX flows and wireframes', type: 'design', desc: 'Map the end-to-end journey and produce wireframes for all new screens.' }, 'US-1');
  add({ title: 'Core data model and schema', type: 'database', desc: 'Define tables, relations and indexes for the feature’s main entities.' }, 'US-1');
  add({ title: 'Core REST API endpoints', type: 'backend', desc: 'CRUD endpoints with validation, error handling and authorisation checks.' }, 'US-1');
  add({ title: 'Core feature screens', type: 'frontend', desc: 'Main screens connected to the API with loading, empty and error states.' }, 'US-1');
  stories.filter((st) => st.module === 'manage').forEach((st) => {
    add({ title: 'List, detail and edit views', type: 'frontend', desc: 'Paginated list, detail page and edit form with confirmation states.' }, st.id);
    add({ title: 'Update, delete and audit endpoints', type: 'backend', desc: 'Update and soft-delete endpoints with an audit trail.' }, st.id);
  });
  stories.filter((st) => st.module && st.module !== 'manage').forEach((st) => {
    const m = modules.find((x) => x.key === st.module);
    m.tasks.forEach((t) => add(t, st.id));
  });
  add({ title: 'Analytics event tracking', type: 'data', desc: 'Instrument key funnel events to measure the success metrics.' }, 'US-1');
  add({ title: 'Automated tests (unit, API, end-to-end)', type: 'qa', desc: 'Cover the main flow, edge cases and permissions.' }, 'US-1');
  add({ title: 'Feature flag, monitoring and release', type: 'devops', desc: 'Roll out behind a flag with dashboards, alerts and a rollback plan.' }, 'US-1');

  // ----- PRD -----
  const contextLine = input.context ? ` for ${input.context}` : '';
  const prd = {
    title,
    summary: `This PRD defines the “${title}” feature${contextLine}. ${sentenceCase(idea.replace(/\s+/g, ' ').replace(/\.?$/, '.'))}`,
    problem: `${personas.map((p) => p.name).join(', ')} currently rely on manual or disconnected steps to get this done, which is slow, error-prone and hard to track. ${personas[0].name}s ${personas[0].need}.`,
    goals: [
      ...modules.map((m) => m.goal),
      'Ship a usable first version within the planned sprints',
      'Measure adoption from day one',
    ].slice(0, 6),
    nonGoals: [
      'Native mobile apps (responsive web only in this release)',
      'Migrating historical data from legacy tools',
      'Multi-language support',
      ...(modules.some((m) => m.key === 'ai') ? [] : ['AI-driven automation']),
    ].filter((g) => !(g.startsWith('Native mobile') && modules.some((m) => m.key === 'mobile'))).slice(0, 4),
    personas,
    requirements: {
      functional: stories.map((s) => `${s.persona}s can ${s.action}`),
      nonFunctional: [
        ...modules.map((m) => m.nfr),
        'Pages meet WCAG 2.1 AA (including 4.5:1 text contrast)',
        'p95 API response time under 400 ms',
      ],
    },
    metrics: [...modules.map((m) => m.metric), 'Feature adoption: % of active users who complete the main flow within 30 days'].slice(0, 6),
    assumptions: ['Existing design system and authentication can be reused', 'Team has access to required third-party accounts'],
    openQuestions: [
      'What is the launch date or external deadline?',
      ...(modules.some((m) => m.key === 'payments') ? ['Which payment provider and currencies are in scope?'] : []),
      ...(modules.some((m) => m.key === 'notifications') ? ['What notification volume and cost budget is expected?'] : []),
    ],
  };

  return { prd, stories, tasks, detectedModules: modules.map((m) => m.key) };
}

module.exports = { generate, detectModules };
