import { Prisma } from '@prisma/client';
import { DEFENCES, FRIGATE_STRIKE_SAFETY_ROUND_CAP, GALAXY_COORDINATE_BOUNDS, SHIPS } from '@eonrover/shared';
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

type UnitMap = Record<string, number>;
type SafeSnapshot = {
  target: { galaxy: number; system: number; slot: number; planet: { name: string; type: string } };
  outcome: 'attacker' | 'defender' | 'draw' | 'unresolved';
  starting: { attacker: UnitMap; defender: UnitMap };
  survivors: { attacker: UnitMap; defender: UnitMap };
  losses: { attacker: UnitMap; defender: UnitMap };
  rounds: Array<{ round: number; attackerLosses: UnitMap; defenderLosses: UnitMap }>;
};
type CanonicalReportRow = { id: string; createdAt: Date; resultSnapshot: Prisma.JsonValue };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? (Object.is(value, -0) ? 0 : value) : null;
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function units(value: unknown): UnitMap | null {
  if (!isRecord(value)) return null;
  const permitted = new Set([...Object.keys(SHIPS), ...Object.keys(DEFENCES)]);
  const result: UnitMap = {};
  for (const key of Object.keys(value).sort()) {
    if (!permitted.has(key)) return null;
    const count = safeInteger(value[key]);
    if (count === null) return null;
    if (count > 0) result[key] = count;
  }
  return result;
}

function safeTarget(value: unknown): SafeSnapshot['target'] | null {
  if (!isRecord(value) || !exactKeys(value, ['coordinates', 'planet']) || !isRecord(value.coordinates) || !isRecord(value.planet)
    || !exactKeys(value.coordinates, ['galaxy', 'slot', 'system']) || !exactKeys(value.planet, ['name', 'type'])) return null;
  const galaxy = safeInteger(value.coordinates.galaxy);
  const system = safeInteger(value.coordinates.system);
  const slot = safeInteger(value.coordinates.slot);
  if (galaxy === null || galaxy < GALAXY_COORDINATE_BOUNDS.galaxy.min || galaxy > GALAXY_COORDINATE_BOUNDS.galaxy.max
    || system === null || system < GALAXY_COORDINATE_BOUNDS.system.min || system > GALAXY_COORDINATE_BOUNDS.system.max
    || slot === null || slot < GALAXY_COORDINATE_BOUNDS.slot.min || slot > GALAXY_COORDINATE_BOUNDS.slot.max
    || typeof value.planet.name !== 'string' || value.planet.name.length === 0
    || typeof value.planet.type !== 'string' || value.planet.type.length === 0) return null;
  return { galaxy, system, slot, planet: { name: value.planet.name, type: value.planet.type } };
}

function forceGroups(value: unknown): { attacker: UnitMap; defender: UnitMap } | null {
  if (!isRecord(value) || !exactKeys(value, ['attacker', 'defender'])) return null;
  const attacker = units(value.attacker);
  const defender = units(value.defender);
  if (!attacker || !defender || Object.keys(attacker).some((key) => key !== 'frigate')) return null;
  return { attacker, defender };
}

/** Projects only the immutable canonical Frigate result contract from JSON. */
function safeSnapshot(value: unknown): SafeSnapshot | null {
  if (!isRecord(value) || !exactKeys(value, ['losses', 'outcome', 'resolution', 'rounds', 'starting', 'survivors', 'target'])) return null;
  const target = safeTarget(value.target);
  const starting = forceGroups(value.starting);
  const survivors = forceGroups(value.survivors);
  const losses = forceGroups(value.losses);
  const outcome = value.outcome;
  if (!target || !starting || !survivors || !losses
    || !['attacker', 'defender', 'draw', 'unresolved'].includes(outcome as string)
    || !['elimination', 'stalemate', 'safety-cap'].includes(value.resolution as string)
    || !Array.isArray(value.rounds) || value.rounds.length > FRIGATE_STRIKE_SAFETY_ROUND_CAP) return null;
  const rounds: SafeSnapshot['rounds'] = [];
  for (let index = 0; index < value.rounds.length; index += 1) {
    const round = value.rounds[index];
    if (!isRecord(round) || !exactKeys(round, ['attackerLosses', 'defenderLosses', 'round']) || safeInteger(round.round) !== index + 1) return null;
    const attackerLosses = units(round.attackerLosses);
    const defenderLosses = units(round.defenderLosses);
    if (!attackerLosses || !defenderLosses || Object.keys(attackerLosses).some((key) => key !== 'frigate')) return null;
    rounds.push({ round: index + 1, attackerLosses, defenderLosses });
  }
  return { target, outcome: outcome as SafeSnapshot['outcome'], starting, survivors, losses, rounds };
}

function total(value: UnitMap): number {
  return Object.values(value).reduce((sum, amount) => sum + amount, 0);
}

function splitDefender(value: UnitMap): { ships: UnitMap; defences: UnitMap } {
  const ships: UnitMap = {}; const defences: UnitMap = {};
  for (const key of Object.keys(value).sort()) {
    if (key in SHIPS) ships[key] = value[key];
    if (key in DEFENCES) defences[key] = value[key];
  }
  return { ships, defences };
}

function targetPresentation(snapshot: SafeSnapshot) {
  return {
    galaxy: snapshot.target.galaxy,
    system: snapshot.target.system,
    slot: snapshot.target.slot,
    planet: snapshot.target.planet,
  };
}

function attackerCounts(snapshot: SafeSnapshot) {
  return {
    startingFrigates: snapshot.starting.attacker.frigate ?? 0,
    lostFrigates: snapshot.losses.attacker.frigate ?? 0,
    survivingFrigates: snapshot.survivors.attacker.frigate ?? 0,
  };
}

function presentList(row: CanonicalReportRow, snapshot: SafeSnapshot) {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    target: targetPresentation(snapshot),
    outcome: snapshot.outcome,
    attacker: attackerCounts(snapshot),
    defender: {
      startingUnits: total(snapshot.starting.defender),
      lostUnits: total(snapshot.losses.defender),
      survivingUnits: total(snapshot.survivors.defender),
    },
  };
}

function presentDetail(row: CanonicalReportRow, snapshot: SafeSnapshot) {
  const defenderStarting = splitDefender(snapshot.starting.defender);
  const defenderLosses = splitDefender(snapshot.losses.defender);
  const defenderSurvivors = splitDefender(snapshot.survivors.defender);
  return {
    ...presentList(row, snapshot),
    rounds: snapshot.rounds.map((round) => ({
      round: round.round,
      attackerLostFrigates: round.attackerLosses.frigate ?? 0,
      defenderLostUnits: total(round.defenderLosses),
    })),
    defender: {
      ships: { starting: defenderStarting.ships, lost: defenderLosses.ships, surviving: defenderSurvivors.ships },
      defences: { starting: defenderStarting.defences, lost: defenderLosses.defences, surviving: defenderSurvivors.defences },
    },
  };
}

router.get('/', asyncHandler(async (req, res) => {
  const parsed = paginationSchema.safeParse(req.query);
  if (!parsed.success) { sendValidationError(res, parsed.error, 'Invalid report pagination'); return; }
  const { page, pageSize } = parsed.data;
  const where = { attackerId: req.user!.id };
  const [totalReports, reports] = await Promise.all([
    prisma.frigateStrikeReport.count({ where }),
    prisma.frigateStrikeReport.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, createdAt: true, resultSnapshot: true },
    }),
  ]);
  const safeReports = reports.flatMap((report) => {
    const snapshot = safeSnapshot(report.resultSnapshot);
    return snapshot ? [presentList(report, snapshot)] : [];
  });
  res.json({ reports: safeReports, page, pageSize, total: totalReports });
}));

router.get('/:reportId', asyncHandler(async (req, res) => {
  const parsed = reportIdSchema.safeParse(req.params);
  if (!parsed.success) { sendValidationError(res, parsed.error, 'Invalid report identifier'); return; }
  const report = await prisma.frigateStrikeReport.findFirst({
    where: { id: parsed.data.reportId, attackerId: req.user!.id },
    select: { id: true, createdAt: true, resultSnapshot: true },
  });
  if (!report) { sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Report not found.'); return; }
  const snapshot = safeSnapshot(report.resultSnapshot);
  if (!snapshot) { sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Report not found.'); return; }
  res.json(presentDetail(report, snapshot));
}));

export default router;
