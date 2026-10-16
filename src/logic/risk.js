// Delivery risk assessment (0–100 → low / medium / high) with a mitigation per factor.

function assessRisk({ input, tasks, sprints, critical, overflow }) {
  const text = [input.featureIdea, input.context, ...tasks.map((t) => `${t.title} ${t.description}`)].join(' ').toLowerCase();
  const factors = [];
  const addFactor = (factor, impact, mitigation) => factors.push({ factor, impact, mitigation });

  if (/payment|deposit|checkout|billing|refund/.test(text)) addFactor('Handles payments', 15, 'Use the provider’s hosted checkout and test webhooks in sandbox before launch.');
  if (/\bsso\b|oauth|authenticat|permission|personal data|pii/.test(text)) addFactor('Security-sensitive (auth / personal data)', 10, 'Run a security review and threat model before release.');
  const integrations = tasks.filter((t) => t.type === 'integration').length;
  if (integrations) addFactor(`${integrations} third-party integration${integrations > 1 ? 's' : ''}`, Math.min(18, integrations * 6), 'Spike each integration early; agree API limits and sandbox access.');
  if (/real-?time|websocket|\blive update/.test(text)) addFactor('Real-time requirements', 12, 'Prototype the socket layer early and load test at expected peak.');
  if (/\bml\b|machine learning|recommend|llm|\bai\b|predict/.test(text)) addFactor('ML / AI uncertainty', 12, 'Define an offline evaluation set and a rule-based fallback.');
  if (/data migration|legacy|\bimport (existing|historical|legacy)/.test(text)) addFactor('Data migration or legacy sync', 10, 'Dry-run migrations on a copy of production data.');

  const totalPoints = tasks.reduce((a, t) => a + t.effort.points, 0);
  if (totalPoints > 100) addFactor(`Very large scope (${totalPoints} points)`, 18, 'Split into phased releases with a smaller MVP.');
  else if (totalPoints > 60) addFactor(`Large scope (${totalPoints} points)`, 10, 'Confirm MVP scope; move Could-have stories to a later phase.');

  if (sprints.length > 4) addFactor(`Long timeline (${sprints.length} sprints)`, 8, 'Add a mid-point demo and re-plan checkpoint.');

  const big = tasks.filter((t) => t.effort.points >= 8).length;
  if (big) addFactor(`${big} task${big > 1 ? 's' : ''} estimated at 8+ points`, Math.min(12, big * 4), 'Break large tasks down further during refinement.');

  if (critical.path.length >= 6) addFactor(`Long dependency chain (${critical.path.length} tasks)`, 8, 'Parallelise where possible and track critical-path tasks daily.');
  if (overflow.length) addFactor('Tasks exceed sprint capacity', 10, `Split ${overflow.join(', ')} into smaller tasks.`);
  if (input.businessPriority === 'critical' && sprints.length > 2) addFactor('Critical priority with multi-sprint delivery', 6, 'Agree a fixed-scope MVP date with stakeholders.');

  factors.sort((a, b) => b.impact - a.impact);
  const score = Math.min(100, factors.reduce((a, f) => a + f.impact, 0));
  const level = score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';
  return { level, score, factors };
}

module.exports = { assessRisk };
