// Priority scoring (0–100) → P0–P3. Combines user value (MoSCoW of the parent story),
// business urgency, how much other work the task unblocks, risk reduction and an
// effort penalty (a lightweight WSJF-style model). Every component is explained.

const MOSCOW_POINTS = { Must: 40, Should: 25, Could: 12, "Won't": 0 };
const BUSINESS_POINTS = { critical: 20, high: 14, medium: 8, low: 3 };
const ENABLER_POINTS = { database: 12, design: 10, backend: 8, integration: 6, frontend: 4, qa: 3, devops: 2, data: 0 };
const RISKY = /payment|security|auth|\bsso\b|integrat|data migration|real-?time|recommend|\bml\b/i;

const LEVELS = [
  { min: 75, level: 'P0', label: 'Critical' },
  { min: 55, level: 'P1', label: 'High' },
  { min: 35, level: 'P2', label: 'Medium' },
  { min: 0, level: 'P3', label: 'Low' },
];

function scorePriority(task, { story, businessPriority, unblocks }) {
  const reasons = [];
  let score = 0;

  const moscow = story?.moscow || 'Should';
  score += MOSCOW_POINTS[moscow];
  reasons.push(`${moscow} story`);

  score += BUSINESS_POINTS[businessPriority] ?? 8;
  if (businessPriority === 'critical' || businessPriority === 'high') reasons.push(`${businessPriority} business priority`);

  const enabler = ENABLER_POINTS[task.type] ?? 0;
  score += enabler;

  const blockBonus = Math.min(15, unblocks * 2);
  score += blockBonus;
  if (unblocks > 0) reasons.push(`unblocks ${unblocks} task${unblocks === 1 ? '' : 's'}`);

  if (RISKY.test(`${task.title} ${task.description}`)) {
    score += 5;
    reasons.push('de-risk early');
  }

  const pts = task.effort.points;
  if (pts >= 8) {
    score -= 6;
    reasons.push('large effort');
  } else if (pts <= 2 && moscow === 'Must') {
    score += 3;
    reasons.push('quick win');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const { level, label } = LEVELS.find((l) => score >= l.min);
  return { level, label, score, reasons };
}

module.exports = { scorePriority, LEVELS };
