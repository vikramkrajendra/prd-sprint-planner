// AI generator: asks an OpenAI model for a PRD, user stories and engineering tasks
// as strict JSON, then validates and normalises the response. The logic layer
// (priority, effort, dependencies, sprints) is NOT delegated to the model — it is
// computed deterministically afterwards so results are explainable and consistent.
const config = require('../config');

const TASK_TYPES = ['design', 'database', 'backend', 'integration', 'frontend', 'data', 'qa', 'devops'];
const MOSCOW = ['Must', 'Should', 'Could', "Won't"];

const SYSTEM_PROMPT = `You are a senior product manager and tech lead.
Turn the feature idea into a concise PRD, user stories and engineering tasks.
Respond with ONLY a JSON object of this exact shape:
{
  "prd": {
    "title": "short feature name (max 8 words)",
    "summary": "2-3 sentences",
    "problem": "2-3 sentences",
    "goals": ["3-5 items"],
    "nonGoals": ["2-4 items"],
    "personas": [{"name": "role", "need": "what they need"}],
    "requirements": {"functional": ["..."], "nonFunctional": ["..."]},
    "metrics": ["3-5 measurable success metrics"],
    "assumptions": ["..."],
    "openQuestions": ["..."]
  },
  "stories": [
    {"id": "US-1", "persona": "role", "action": "what they want to do (starts with a verb)", "benefit": "why",
     "acceptance": ["2-4 testable criteria"], "moscow": "Must|Should|Could|Won't"}
  ],
  "tasks": [
    {"id": "T-1", "title": "imperative task title", "description": "one sentence",
     "type": "design|database|backend|integration|frontend|data|qa|devops", "storyId": "US-1"}
  ]
}
Rules: 4-8 stories, 10-24 tasks, every task belongs to a story, include design, database, backend,
frontend, qa and devops work where relevant. Do not estimate effort or priority.`;

function asArray(v) {
  return Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined && x !== '') : [];
}
function asText(v, fallback = '') {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

function normalise(raw, input) {
  if (!raw || typeof raw !== 'object') throw new Error('AI response is not an object');
  const p = raw.prd || {};
  const prd = {
    title: asText(p.title, 'New feature').slice(0, 80),
    summary: asText(p.summary, input.featureIdea),
    problem: asText(p.problem),
    goals: asArray(p.goals).map(String),
    nonGoals: asArray(p.nonGoals).map(String),
    personas: asArray(p.personas).map((x) => ({ name: asText(x.name, 'User'), need: asText(x.need) })),
    requirements: {
      functional: asArray(p.requirements?.functional).map(String),
      nonFunctional: asArray(p.requirements?.nonFunctional).map(String),
    },
    metrics: asArray(p.metrics).map(String),
    assumptions: asArray(p.assumptions).map(String),
    openQuestions: asArray(p.openQuestions).map(String),
  };

  const stories = asArray(raw.stories).map((s, i) => ({
    id: `US-${i + 1}`,
    originalId: asText(s.id),
    persona: asText(s.persona, 'User'),
    action: asText(s.action).replace(/^to\s+/i, ''),
    benefit: asText(s.benefit),
    acceptance: asArray(s.acceptance).map(String).slice(0, 6),
    moscow: MOSCOW.includes(s.moscow) ? s.moscow : 'Should',
  }));
  if (stories.length < 2) throw new Error('AI returned too few user stories');

  // Re-key story ids so tasks always reference valid stories.
  const storyMap = Object.fromEntries(stories.map((s) => [s.originalId, s.id]));
  stories.forEach((s) => delete s.originalId);

  const tasks = asArray(raw.tasks).map((t, i) => {
    const type = String(t.type || '').toLowerCase();
    return {
      id: `T-${i + 1}`,
      title: asText(t.title, `Task ${i + 1}`),
      description: asText(t.description),
      type: TASK_TYPES.includes(type) ? type : guessType(`${t.title} ${t.description}`),
      storyId: storyMap[t.storyId] || stories[0].id,
    };
  });
  if (tasks.length < 4) throw new Error('AI returned too few tasks');

  return { prd, stories, tasks };
}

function guessType(text) {
  const t = text.toLowerCase();
  if (/schema|table|migration|database|index/.test(t)) return 'database';
  if (/ui|screen|page|component|frontend|form/.test(t)) return 'frontend';
  if (/test|qa|verify/.test(t)) return 'qa';
  if (/deploy|release|monitor|ci|flag/.test(t)) return 'devops';
  if (/design|wireframe|ux|mockup/.test(t)) return 'design';
  if (/integrat|provider|third|webhook|sso/.test(t)) return 'integration';
  if (/analytics|tracking|model|data/.test(t)) return 'data';
  return 'backend';
}

async function generate(input, { timeoutMs = 45000 } = {}) {
  if (!config.openaiKey) throw new Error('OPENAI_API_KEY is not set');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.openaiKey}` },
      body: JSON.stringify({
        model: config.openaiModel,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Feature idea: ${input.featureIdea}\nProduct context: ${input.context || 'not specified'}\nBusiness priority: ${input.businessPriority}`,
          },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI API ${res.status}: ${body.slice(0, 160)}`);
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    const result = normalise(JSON.parse(content), input);
    result.usage = data.usage || null;
    result.model = data.model || config.openaiModel;
    return result;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`OpenAI request timed out after ${timeoutMs / 1000}s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { generate, normalise, TASK_TYPES };
