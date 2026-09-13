import { EspionageProbeDisclosureTier, Prisma } from '@prisma/client';
import { BUILDINGS, DEFENCES, GALAXY_COORDINATE_BOUNDS, SHIPS } from '@eonrover/shared';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireReadOnlyAuth } from '../middleware/auth';
import { asyncHandler, ERROR_CODES, sendError, sendValidationError } from '../middleware/error';

const router = Router();
router.use(requireReadOnlyAuth);

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
const reportIdSchema = z.object({ reportId: z.string().uuid() });

type SafeTarget = {
  coordinates: { galaxy: number; system: number; slot: number };
  planetName: string;
  planetType: string;
  ownerUsername: string;
};

type SafeIntelligence = {
  target: SafeTarget;
  tier: EspionageProbeDisclosureTier;
  resources?: { alloy: number; heliox: number; aether: number };
  buildings?: Record<string, number>;
  ships?: Record<string, number>;
  defences?: Record<string, number>;
};

type CanonicalReportRow = {
  id: string;
  createdAt: Date;
  tier: EspionageProbeDisclosureTier;
  disclosureSnapshot: Prisma.JsonValue;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonNegativeFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? (Object.is(value, -0) ? 0 : value) : null;
}

function nonNegativeSafeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? (Object.is(value, -0) ? 0 : value) : null;
}

function safeTarget(value: unknown): SafeTarget | null {
  if (!isRecord(value) || !isRecord(value.coordinates)) return null;
  const { galaxy, system, slot } = value.coordinates;
  if (
    typeof galaxy !== 'number' || !Number.isSafeInteger(galaxy)
    || typeof system !== 'number' || !Number.isSafeInteger(system)
    || typeof slot !== 'number' || !Number.isSafeInteger(slot)
    || galaxy < GALAXY_COORDINATE_BOUNDS.galaxy.min || galaxy > GALAXY_COORDINATE_BOUNDS.galaxy.max
    || system < GALAXY_COORDINATE_BOUNDS.system.min || system > GALAXY_COORDINATE_BOUNDS.system.max
    || slot < GALAXY_COORDINATE_BOUNDS.slot.min || slot > GALAXY_COORDINATE_BOUNDS.slot.max
    || typeof value.planetName !== 'string' || value.planetName.length === 0
    || typeof value.planetType !== 'string' || value.planetType.length === 0
    || typeof value.ownerUsername !== 'string' || value.ownerUsername.length === 0
  ) return null;
  return {
    coordinates: { galaxy, system, slot },
    planetName: value.planetName,
    planetType: value.planetType,
    ownerUsername: value.ownerUsername,
  };
}

function safeResources(value: unknown): { alloy: number; heliox: number; aether: number } | null {
  if (!isRecord(value)) return null;
  const alloy = nonNegativeFiniteNumber(value.alloy);
  const heliox = nonNegativeFiniteNumber(value.heliox);
  const aether = nonNegativeFiniteNumber(value.aether);
  return alloy === null || heliox === null || aether === null ? null : { alloy, heliox, aether };
}

function safeQuantities(value: unknown, definitions: Record<string, unknown>): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const quantities: Record<string, number> = {};
  for (const key of Object.keys(definitions).sort()) {
    if (value[key] === undefined) continue;
    const amount = nonNegativeSafeInteger(value[key]);
    if (amount === null || amount === 0) return null;
    quantities[key] = amount;
  }
  return quantities;
}

/** Projects only the immutable Stage 11B4a disclosure fields from JSON. */
function presentIntelligence(row: CanonicalReportRow): SafeIntelligence | null {
  const snapshot = row.disclosureSnapshot;
  if (!isRecord(snapshot) || snapshot.tier !== row.tier) return null;
  const target = safeTarget(snapshot.target);
  if (!target) return null;
  const intelligence: SafeIntelligence = { target, tier: row.tier };
  if (row.tier === 'IDENTITY') return intelligence;
  const resources = safeResources(snapshot.resources);
  if (!resources) return null;
  intelligence.resources = resources;
  if (row.tier === 'RESOURCES') return intelligence;
  const buildings = safeQuantities(snapshot.buildings, BUILDINGS);
  if (!buildings) return null;
  intelligence.buildings = buildings;
  if (row.tier === 'BUILDINGS') return intelligence;
  const ships = safeQuantities(snapshot.ships, SHIPS);
  const defences = safeQuantities(snapshot.defences, DEFENCES);
  if (!ships || !defences) return null;
  intelligence.ships = ships;
  intelligence.defences = defences;
  return intelligence;
}

function presentListItem(row: CanonicalReportRow, intelligence: SafeIntelligence) {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    tier: row.tier,
    target: {
      galaxy: intelligence.target.coordinates.galaxy,
      system: intelligence.target.coordinates.system,
      slot: intelligence.target.coordinates.slot,
      planet: { name: intelligence.target.planetName, type: intelligence.target.planetType },
    },
  };
}

router.get('/', asyncHandler(async (req, res) => {
  const parsed = paginationSchema.safeParse(req.query);
  if (!parsed.success) { sendValidationError(res, parsed.error, 'Invalid report pagination'); return; }
  const { page, pageSize } = parsed.data;
  const where = { attackerId: req.user!.id };
  const [total, reports] = await Promise.all([
    prisma.espionageProbeReport.count({ where }),
    prisma.espionageProbeReport.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, createdAt: true, tier: true, disclosureSnapshot: true },
    }),
  ]);
  const safeReports = reports.flatMap((report) => {
    const intelligence = presentIntelligence(report);
    return intelligence ? [presentListItem(report, intelligence)] : [];
  });
  res.json({ reports: safeReports, page, pageSize, total });
}));

router.get('/:reportId', asyncHandler(async (req, res) => {
  const parsed = reportIdSchema.safeParse(req.params);
  if (!parsed.success) { sendValidationError(res, parsed.error, 'Invalid report identifier'); return; }
  const report = await prisma.espionageProbeReport.findFirst({
    where: { id: parsed.data.reportId, attackerId: req.user!.id },
    select: { id: true, createdAt: true, tier: true, disclosureSnapshot: true },
  });
  if (!report) { sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Report not found.'); return; }
  const intelligence = presentIntelligence(report);
  if (!intelligence) { sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Report not found.'); return; }
  res.json({ id: report.id, createdAt: report.createdAt.toISOString(), tier: report.tier, intelligence });
}));

export default router;
