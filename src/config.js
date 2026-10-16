// Loads configuration from environment variables (and an optional .env file).
const fs = require('fs');
const path = require('path');

function loadDotEnv() {
  const file = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^['"]|['"]$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadDotEnv();

module.exports = {
  port: Number(process.env.PORT) || 3000,
  openaiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  adminKey: process.env.ADMIN_KEY || '',
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'planner.db'),
  defaults: {
    sprintCapacity: 20, // story points per sprint
    sprintLengthWeeks: 2,
    hoursPerPoint: 4,
  },
};
