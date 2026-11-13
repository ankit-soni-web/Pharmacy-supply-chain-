import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { registerAlertAgentRoutes } from './server/agents/alertAgent.ts';
import { registerCoordinationAgentRoutes } from './server/agents/coordinationAgent.ts';
import { registerPharmaRagRoutes } from './server/agents/pharmaRagAgent.ts';
import { registerReportingAgentRoutes } from './server/agents/reportingAgent.ts';
import { registerRouteAgentRoutes } from './server/agents/routeAgent.ts';
import { registerSupplyAgentRoutes } from './server/agents/supplyAgent.ts';
import { eventBus } from './server/eventBus.ts';
import { attachAuthContext } from './server/middleware/auth.ts';
import { store } from './server/store.ts';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '2mb' }));
  app.use(attachAuthContext);

  const apiRouter = express.Router();

  // Shared orchestrator & governance endpoints
  apiRouter.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'RouteRescue AI', region: 'Madhya Pradesh, India' });
  });

  apiRouter.get('/bootstrap', (_req, res) => {
    res.json({
      districts: store.districts,
      organizations: store.organizations,
      nodes: store.nodes,
      medicines: store.medicines,
      levelNeeds: store.levelNeeds,
      dataSources: store.dataSources,
      auditLogs: store.auditLogs.slice(0, 60),
      recentEvents: eventBus.getRecentEvents(40),
    });
  });

  apiRouter.get('/events', (req, res) => {
    const limit = Number(req.query.limit) || 50;
    res.json({ events: eventBus.getRecentEvents(limit) });
  });

  apiRouter.get('/events/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ type: 'CONNECTED', timestamp: new Date().toISOString() })}\n\n`);
    eventBus.registerSseClient(res);
  });

  apiRouter.get('/audit', (_req, res) => {
    res.json({ auditLogs: store.auditLogs });
  });

  apiRouter.get('/sources', (_req, res) => {
    res.json({ dataSources: store.dataSources });
  });

  // Mount all 5 specialized agent routers on the single shared backend
  registerRouteAgentRoutes(apiRouter);
  registerSupplyAgentRoutes(apiRouter);
  registerReportingAgentRoutes(apiRouter);
  registerAlertAgentRoutes(apiRouter);
  registerPharmaRagRoutes(apiRouter);
  registerCoordinationAgentRoutes(apiRouter);

  app.use('/api', apiRouter);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`RouteRescue AI unified server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start RouteRescue AI server:', err);
  process.exit(1);
});
