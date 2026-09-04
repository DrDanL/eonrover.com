import { PrismaClient } from '@prisma/client';
import { getApiConfig } from '../config';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

const config = getApiConfig();

export const prisma =
  global.__prisma ??
  new PrismaClient({
    datasources: { db: { url: config.databaseUrl } },
  });

if (config.environment !== 'production') {
  global.__prisma = prisma;
}
