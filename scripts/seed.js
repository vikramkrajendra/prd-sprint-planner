// Seeds the database with sample workflows spread over the last two weeks,
// so the admin dashboard has data to show. Usage: npm run seed
const store = require('../src/db');
const { validateWorkflowInput } = require('../src/validation');
const rules = require('../src/generator/ruleGenerator');
const { applyLogic } = require('../src/logic');

const SAMPLES = [
  ['Let customers book salon appointments online, pay a deposit by card, and receive SMS reminders 24 hours before the visit. Staff should see a daily calendar.', 'B2C salon booking app', 'high'],
  ['Add real-time team chat with channels, direct messages, file upload, message search and push notifications for mentions.', 'B2B project management SaaS', 'medium'],
  ['Employees can submit expense reports with receipt photos, managers approve or reject them, and finance can export approved expenses to CSV for payroll. Integrate with our existing SSO login.', 'Internal HR tool', 'critical'],
  ['We need a way to track inventory levels across warehouses', 'Retail chain operations', 'medium'],
  ['Students can see personalised course recommendations based on their progress and get email reminders for upcoming deadlines.', 'Online learning platform', 'low'],
  ['Let sellers upload product photos, set prices and manage stock, with a dashboard showing weekly sales analytics.', 'Marketplace', 'high'],
  ['Patients can book telehealth visits, join a live video call, and receive a summary afterwards.', 'Clinic network', 'critical'],
  ['Allow admins to manage user roles and permissions, with an audit log of every change.', 'Enterprise SaaS', 'medium'],
];

store.init();
let n = 0;
SAMPLES.forEach(([featureIdea, context, businessPriority], i) => {
  const input = validateWorkflowInput({ featureIdea, context, businessPriority, sprintCapacity: [20, 25, 30][i % 3] });
  const draft = rules.generate(input);
  const plan = applyLogic(draft, input);
  const daysAgo = Math.floor((i / SAMPLES.length) * 13);
  const createdAt = new Date(Date.now() - daysAgo * 864e5 - i * 3600e3).toISOString();
  const wf = {
    createdAt, source: 'rules', fallbackReason: 'Seed data', input, prd: draft.prd, stories: draft.stories, ...plan,
    pipeline: [{ step: 'input', ms: 0, status: 'ok' }, { step: 'generation', ms: 3, status: 'ok', detail: 'rule-based' }, { step: 'logic', ms: 4, status: 'ok' }],
  };
  const id = store.saveWorkflow(wf, 15 + ((i * 37) % 60));
  store.logActivity({ workflowId: id, event: 'workflow.seeded', message: `Seeded “${wf.prd.title}”` });
  n++;
});
console.log(`Seeded ${n} workflows.`);
