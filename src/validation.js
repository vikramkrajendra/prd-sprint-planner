// Validates and normalises the request body for a new workflow.
const config = require('./config');

const PRIORITIES = ['low', 'medium', 'high', 'critical'];

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function validateWorkflowInput(body) {
  const featureIdea = typeof body.featureIdea === 'string' ? body.featureIdea.trim() : '';
  if (featureIdea.length < 20) throw badRequest('featureIdea must be at least 20 characters');
  if (featureIdea.length > 2000) throw badRequest('featureIdea must be at most 2000 characters');

  const context = typeof body.context === 'string' ? body.context.trim().slice(0, 300) : '';
  const businessPriority = PRIORITIES.includes(body.businessPriority) ? body.businessPriority : 'medium';

  const sprintCapacity = body.sprintCapacity === undefined ? config.defaults.sprintCapacity : Number(body.sprintCapacity);
  if (!Number.isFinite(sprintCapacity) || sprintCapacity < 5 || sprintCapacity > 100) {
    throw badRequest('sprintCapacity must be a number between 5 and 100');
  }
  const sprintLengthWeeks = [1, 2, 3].includes(Number(body.sprintLengthWeeks)) ? Number(body.sprintLengthWeeks) : config.defaults.sprintLengthWeeks;

  return {
    featureIdea,
    context,
    businessPriority,
    sprintCapacity: Math.round(sprintCapacity),
    sprintLengthWeeks,
    useAI: body.useAI !== false,
  };
}

module.exports = { validateWorkflowInput, PRIORITIES };
