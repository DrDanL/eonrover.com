import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Express } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { getApiConfig } from './config';
import { prisma } from './lib/prisma';
import { connection } from './lib/redis';
import { createHealthRouter, ReadinessChecks } from './health';
import { requireCsrfHeader } from './middleware/auth';
import authRoutes from './routes/auth';
import planetRoutes from './routes/planets';
import buildingRoutes from './routes/buildings';
import researchRoutes from './routes/research';
import shipyardRoutes from './routes/shipyard';
import fleetRoutes from './routes/fleet';
import gateRoutes from './routes/gates';
import galaxyRoutes from './routes/galaxy';
import messageRoutes from './routes/messages';
import allianceRoutes from './routes/alliances';
import leaderboardRoutes from './routes/leaderboard';
import notificationRoutes from './routes/notifications';
import publicRoutes from './routes/public';
import adminRoutes from './routes/admin';
import reportRoutes from './routes/reports';
import {
  apiErrorHandler,
  apiNotFoundHandler,
  rateLimitErrorHandler,
} from './middleware/error';

const config = getApiConfig();

export interface AppOptions {
  readinessChecks?: ReadinessChecks;
  readinessTimeoutMs?: number;
}

const readinessChecks: ReadinessChecks = {
  database: async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
  redis: async () => {
    await connection.ping();
  },
};

export function createApp(options: AppOptions = {}): Express {
  const app = express();

  app.use(createHealthRouter(options.readinessChecks ?? readinessChecks, options.readinessTimeoutMs));

  app.use(helmet());
  app.use(
    cors({
      origin: config.webUrl,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 240,
      standardHeaders: true,
      legacyHeaders: false,
      handler: rateLimitErrorHandler,
    }),
  );
  app.use(requireCsrfHeader);

  app.use('/api/auth', authRoutes);
  app.use('/api/planets', planetRoutes);
  app.use('/api/planets/:planetId/buildings', buildingRoutes);
  app.use('/api/planets/:planetId/shipyard', shipyardRoutes);
  app.use('/api/research', researchRoutes);
  app.use('/api/fleet', fleetRoutes);
  app.use('/api/gates', gateRoutes);
  app.use('/api/galaxy', galaxyRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/alliances', allianceRoutes);
  app.use('/api/leaderboard', leaderboardRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/public', publicRoutes);
  app.use('/api/admin', adminRoutes);

  app.use(apiNotFoundHandler);
  app.use(apiErrorHandler);

  return app;
}
