// Public workflow API used by the main UI.
const { readBody } = require('../http');
const { runWorkflow } = require('../pipeline');

function register(router) {
  // Create: run the full pipeline for a feature idea
  router.post('/api/workflows', async ({ req }) => {
    const receivedAt = Date.now();
    const body = await readBody(req);
    const result = await runWorkflow(body, { receivedAt });
    return { __status: 201, ...result };
  });
}

module.exports = { register };
