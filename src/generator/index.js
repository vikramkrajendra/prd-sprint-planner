// Chooses the generation strategy: AI first (when enabled and configured),
// falling back to the rule-based generator on any failure.
const config = require('../config');
const ai = require('./aiGenerator');
const rules = require('./ruleGenerator');

async function generateDraft(input) {
  const wantsAI = input.useAI !== false;
  if (wantsAI && config.openaiKey) {
    try {
      const draft = await ai.generate(input);
      return { ...draft, source: 'ai', fallbackReason: null };
    } catch (err) {
      const draft = rules.generate(input);
      return { ...draft, source: 'rules', fallbackReason: `AI failed: ${err.message}` };
    }
  }
  const reason = !wantsAI ? 'AI disabled by user' : 'No OpenAI key configured';
  return { ...rules.generate(input), source: 'rules', fallbackReason: reason };
}

module.exports = { generateDraft };
