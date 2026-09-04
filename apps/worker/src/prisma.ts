import { PrismaClient } from '@prisma/client';
import { getWorkerConfig } from './config';

const config = getWorkerConfig();

export const prisma = new PrismaClient({
  datasources: { db: { url: config.databaseUrl } },
});
