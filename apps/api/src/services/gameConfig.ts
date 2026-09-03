import { DEFAULT_UNIVERSE_CONFIG, UniverseConfig } from '@eonrover/shared';
import { prisma } from '../lib/prisma';

let cache: { value: UniverseConfig; expiresAt: number } | null = null;
const CACHE_MS = 5000;

export async function getUniverseConfig(): Promise<UniverseConfig> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  const rows = await prisma.universeSetting.findMany();
  const overrides: Partial<UniverseConfig> = {};
  for (const row of rows) {
    if (row.key in DEFAULT_UNIVERSE_CONFIG) {
      (overrides as Record<string, unknown>)[row.key] = row.value as unknown;
    }
  }
  const value = { ...DEFAULT_UNIVERSE_CONFIG, ...overrides };
  cache = { value, expiresAt: Date.now() + CACHE_MS };
  return value;
}

export async function setUniverseConfigValue(key: keyof UniverseConfig, value: number): Promise<void> {
  await prisma.universeSetting.upsert({
    where: { key },
    update: { value },
    create: { id: key, key, value },
  });
  cache = null;
}

export function invalidateUniverseConfigCache(): void {
  cache = null;
}
