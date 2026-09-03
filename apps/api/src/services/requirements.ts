import { BuildingKey, ResearchKey } from '@eonrover/shared';
import { prisma } from '../lib/prisma';

export async function getBuildingLevels(planetId: string): Promise<Record<string, number>> {
  const rows = await prisma.building.findMany({ where: { planetId } });
  return Object.fromEntries(rows.map((r) => [r.key, r.level]));
}

export async function getResearchLevels(userId: string): Promise<Record<string, number>> {
  const rows = await prisma.research.findMany({ where: { userId } });
  return Object.fromEntries(rows.map((r) => [r.key, r.level]));
}

export function requirementsMet(
  requires: Partial<Record<BuildingKey | ResearchKey, number>> | undefined,
  buildingLevels: Record<string, number>,
  researchLevels: Record<string, number>,
): boolean {
  if (!requires) return true;
  return Object.entries(requires).every(([key, level]) => {
    const current = buildingLevels[key] ?? researchLevels[key] ?? 0;
    return current >= (level ?? 0);
  });
}
