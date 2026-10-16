// Public workflow API used by the main UI.
const { readBody } = require('../http');
const { runWorkflow } = require('../pipeline');
const store = require('../db');

const notFound = () => Object.assign(new Error('Workflow not found'), { status: 404 });

function register(router) {
  // Create: run the full pipeline for a feature idea
  router.post('/api/workflows', async ({ req }) => {
    const receivedAt = Date.now();
    const body = await readBody(req);
    const result = await runWorkflow(body, { receivedAt });
    return { __status: 201, ...result };
  });

  // List saved workflows (history), with optional search
  router.get('/api/workflows', ({ query }) => store.listWorkflows({ q: query.q, limit: query.limit, offset: query.offset }));

  // Retrieve one workflow with its tasks and sprints
  router.get('/api/workflows/:id', ({ params }) => {
    const wf = store.getWorkflow(params.id);
    if (!wf) throw notFound();
    return wf;
  });
}

module.exports = { register };
