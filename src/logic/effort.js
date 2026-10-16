// Effort estimation: story points on the Fibonacci scale, derived from task type
// plus complexity signals found in the task text. Every adjustment is explained.
const config = require('../config');

const FIB = [1, 2, 3, 5, 8, 13];

const BASE_BY_TYPE = { design: 2, database: 3, backend: 3, integration: 5, frontend: 3, data: 3, qa: 3, devops: 2 };

const COMPLEXITY = [
  { re: /payment|webhook|reconciliation|3-d secure|refund/i, add: 2, why: 'payment handling' },
  { re: /real-?time|websocket|\bsocket|\blive\b/i, add: 3, why: 'real-time behaviour' },
  { re: /\bsso\b|oauth|identity|authenticat|security|permission|role-based/i, add: 1, why: 'security-sensitive' },
  { re: /data migration|legacy|\bimport\b|\bsync (with|to|from)\b/i, add: 2, why: 'data migration/sync' },
  { re: /\bml\b|machine learning|llm|recommend|prompt/i, add: 3, why: 'ML / AI uncertainty' },
  { re: /calendar|schedul|availability|conflict/i, add: 1, why: 'scheduling rules' },
  { re: /search|index|ranking/i, add: 1, why: 'search/indexing' },
  { re: /export|stream|large|aggregat/i, add: 1, why: 'large data volumes' },
  { re: /load test|performance|latency/i, add: 1, why: 'performance work' },
  { re: /end-to-end|e2e/i, add: 2, why: 'end-to-end coverage', types: ['qa'] },
  { re: /state machine|audit/i, add: 1, why: 'state/audit rules' },
  { re: /retr(y|ies)|idempot|queue/i, add: 1, why: 'reliability handling' },
];

const SIMPLIFY = /\b(simple|basic|minor|static|copy change)\b/i;

function toFibonacci(n) {
  return FIB.find((f) => f >= n) || FIB.at(-1);
}

function estimateEffort(task) {
  const text = `${task.title} ${task.description}`;
  const base = BASE_BY_TYPE[task.type] ?? 3;
  let raw = base;
  const reasons = [`${task.type} base ${base}`];

  for (const c of COMPLEXITY) {
    if (c.types && !c.types.includes(task.type)) continue;
    if (c.re.test(text)) {
      raw += c.add;
      reasons.push(`+${c.add} ${c.why}`);
    }
  }
  if (task.description && task.description.length > 120) {
    raw += 1;
    reasons.push('+1 broad scope');
  }
  if (SIMPLIFY.test(text)) {
    raw = Math.max(1, raw - 1);
    reasons.push('-1 simple change');
  }

  const points = toFibonacci(raw);
  return { points, hours: points * config.defaults.hoursPerPoint, reasons };
}

module.exports = { estimateEffort, toFibonacci, FIB };
