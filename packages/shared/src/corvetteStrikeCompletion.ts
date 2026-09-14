import { DEFENCES, SHIPS } from './constants';
import { isCorvetteStrikeResolverVersion, resolveCorvetteStrike } from './corvetteStrike';

const ATTEMPTS = 3;

export type CorvetteStrikeCompletionOutcome = 'arrived' | 'returned' | 'early' | 'noop' | 'unavailable';
export interface CorvetteStrikeCompletionDatabase {
  $transaction<T>(callback: (transaction: any) => Promise<T>, options?: unknown): Promise<T>;
}
export interface CorvetteStrikeCompletionOptions {
  scheduleReturnWakeup?: (missionId: string, currentTime: Date) => Promise<unknown>;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function whole(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function technology(value: unknown): { weaponTech: number; shieldTech: number; armourTech: number } | null {
  if (!record(value) || Object.keys(value).sort().join(',') !== 'armourTech,shieldTech,weaponTech'
    || !whole(value.weaponTech) || !whole(value.shieldTech) || !whole(value.armourTech)) return null;
  return { weaponTech: value.weaponTech, shieldTech: value.shieldTech, armourTech: value.armourTech };
}
function manifest(value: unknown): { corvette: number } | null {
  if (!record(value) || Object.keys(value).length !== 1 || !whole(value.corvette) || value.corvette < 1 || value.corvette > 100) return null;
  return { corvette: value.corvette };
}
function isRetryable(error: any): boolean {
  return error?.code === 'P2034' || (error?.code === 'P2010' && error?.meta?.code === '40001');
}
function canonicalMission(mission: any): { ships: { corvette: number }; attackerTechnology: { weaponTech: number; shieldTech: number; armourTech: number }; resolverVersion: 'corvette-strike-v1' | 'corvette-strike-v2' } | null {
  const ships = manifest(mission?.corvetteStrikeShips);
  const attackerTechnology = technology(mission?.corvetteStrikeAttackerTechnology);
  if (!ships || !attackerTechnology || mission?.missionType !== 'ATTACK'
    || !isCorvetteStrikeResolverVersion(mission.corvetteStrikeResolverVersion)
    || typeof mission.corvetteStrikeResolverSeed !== 'string' || !mission.corvetteStrikeResolverSeed
    || !whole(mission.corvetteStrikeOutboundFuelHeliox) || !whole(mission.corvetteStrikeReturnFuelHeliox)
    || !Number.isSafeInteger(mission.corvetteStrikeOutboundDurationSeconds) || mission.corvetteStrikeOutboundDurationSeconds <= 0
    || !Number.isSafeInteger(mission.corvetteStrikeReturnDurationSeconds) || mission.corvetteStrikeReturnDurationSeconds <= 0
    || mission.speedPercent !== 100 || !mission.departedAt || !mission.arrivesAt
    || !Number.isFinite(mission.departedAt.getTime()) || !Number.isFinite(mission.arrivesAt.getTime())
    || mission.arrivesAt.getTime() - mission.departedAt.getTime() !== mission.corvetteStrikeOutboundDurationSeconds * 1_000) return null;
  return { ships, attackerTechnology, resolverVersion: mission.corvetteStrikeResolverVersion };
}
function quantities(rows: Array<{ key: string; count: number }>, definitions: Record<string, unknown>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const row of rows) if (row.key in definitions && whole(row.count) && row.count > 0) result[row.key] = row.count;
  return result;
}
function survivorCount(snapshot: unknown): number | null {
  if (!record(snapshot) || !record(snapshot.survivors) || !record(snapshot.survivors.attacker)) return null;
  const value = snapshot.survivors.attacker.corvette;
  return whole(value) ? value : null;
}
function defenderTechnology(rows: Array<{ key: string; level: number }>) {
  const levels = new Map(rows.map((row) => [row.key, row.level]));
  return { weaponTech: levels.get('weaponTech') ?? 0, shieldTech: levels.get('shieldTech') ?? 0, armourTech: levels.get('armourTech') ?? 0 };
}

/**
 * Settles only persisted canonical Corvette strikes. It never consults legacy
 * Fleet JSON, queued payloads, or caller combat values; all state is locked
 * and reloaded from PostgreSQL inside the serializable transaction.
 */
export async function settleCanonicalCorvetteStrike(
  database: CorvetteStrikeCompletionDatabase,
  missionId: string,
  currentTime = new Date(),
  options: CorvetteStrikeCompletionOptions = {},
): Promise<CorvetteStrikeCompletionOutcome> {
  if (!missionId || !Number.isFinite(currentTime.getTime())) return 'noop';
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    try {
      const outcome = await database.$transaction(async (tx) => {
        // sorted attacker/defender accounts → origin → target → target forces → mission → report
        const accounts = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT account."id" AS "id" FROM "User" account WHERE account."id" IN (
            SELECT "corvetteStrikeAttackerId" FROM "FleetMission" WHERE "id" = ${missionId}
            UNION SELECT "corvetteStrikeDefenderId" FROM "FleetMission" WHERE "id" = ${missionId}
          ) ORDER BY account."id" FOR UPDATE
        `;
        if (accounts.length !== 2 || accounts[0].id === accounts[1].id) return 'noop';
        const originRows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT planet."id" AS "id" FROM "Planet" planet JOIN "FleetMission" mission
          ON mission."corvetteStrikeOriginPlanetId" = planet."id" WHERE mission."id" = ${missionId} FOR UPDATE OF planet
        `;
        const targetRows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT planet."id" AS "id" FROM "Planet" planet JOIN "FleetMission" mission
          ON mission."corvetteStrikeTargetPlanetId" = planet."id" WHERE mission."id" = ${missionId} FOR UPDATE OF planet
        `;
        if (originRows.length !== 1 || targetRows.length !== 1) return 'noop';
        const origin = await tx.planet.findUnique({ where: { id: originRows[0].id } });
        const target = await tx.planet.findUnique({ where: { id: targetRows[0].id } });
        if (!origin || !target || origin.ownerId === target.ownerId) return 'noop';
        await tx.$queryRaw`SELECT "id" FROM "Ship" WHERE "planetId" = ${target.id} FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "Defence" WHERE "planetId" = ${target.id} FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "FleetMission" WHERE "id" = ${missionId} FOR UPDATE`;
        const mission = await tx.fleetMission.findUnique({ where: { id: missionId } });
        if (!mission || mission.corvetteStrikeOriginPlanetId !== origin.id || mission.corvetteStrikeTargetPlanetId !== target.id
          || mission.corvetteStrikeAttackerId !== origin.ownerId || mission.corvetteStrikeDefenderId !== target.ownerId
          || mission.originId !== origin.id || mission.targetId !== target.id || mission.targetGalaxy !== target.galaxy
          || mission.targetSystem !== target.system || mission.targetSlot !== target.slot) return 'noop';
        const canonical = canonicalMission(mission);
        if (!canonical) return 'noop';
        await tx.$queryRaw`SELECT "id" FROM "CorvetteStrikeReport" WHERE "missionId" = ${missionId} FOR UPDATE`;
        const existingReport = await tx.corvetteStrikeReport.findUnique({ where: { missionId } });

        if (mission.corvetteStrikePhase === 'OUTBOUND' && mission.status === 'OUTBOUND') {
          if (mission.arrivesAt > currentTime) return 'early';
          if (existingReport) return 'noop';
          const [ships, defences, research] = await Promise.all([
            tx.ship.findMany({ where: { planetId: target.id }, select: { key: true, count: true } }),
            tx.defence.findMany({ where: { planetId: target.id }, select: { key: true, count: true } }),
            tx.research.findMany({ where: { userId: target.ownerId, key: { in: ['weaponTech', 'shieldTech', 'armourTech'] } }, select: { key: true, level: true } }),
          ]);
          const result = resolveCorvetteStrike({
            version: canonical.resolverVersion,
            seed: mission.corvetteStrikeResolverSeed,
            attacker: { corvettes: canonical.ships.corvette, technology: canonical.attackerTechnology },
            defender: { ships: quantities(ships, SHIPS), defences: quantities(defences, DEFENCES), technology: defenderTechnology(research) },
          });
          // The canonical report must remain independently readable after the
          // mission and target change. Persist the small public target identity
          // alongside the resolver result; never make a later read join live
          // target state as a fallback.
          const reportSnapshot = {
            target: {
              coordinates: { galaxy: target.galaxy, system: target.system, slot: target.slot },
              planet: { name: target.name, type: target.planetType },
            },
            outcome: result.outcome,
            starting: result.starting,
            survivors: result.survivors,
            losses: result.losses,
            rounds: result.rounds,
            ...(result.termination ? { resolution: result.termination } : {}),
          };
          for (const [key, count] of Object.entries(result.losses.defender)) {
            if (count > 0 && key in SHIPS) await tx.ship.updateMany({ where: { planetId: target.id, key, count: { gte: count } }, data: { count: { decrement: count } } });
            if (count > 0 && key in DEFENCES) await tx.defence.updateMany({ where: { planetId: target.id, key, count: { gte: count } }, data: { count: { decrement: count } } });
          }
          const survivors = result.survivors.attacker.corvette ?? 0;
          const returning = survivors > 0;
          const returnsAt = returning ? new Date(currentTime.getTime() + mission.corvetteStrikeReturnDurationSeconds * 1_000) : mission.returnsAt;
          const transition = await tx.fleetMission.updateMany({
            where: { id: mission.id, corvetteStrikePhase: 'OUTBOUND', status: 'OUTBOUND' },
            data: { corvetteStrikePhase: returning ? 'RETURNING' : 'COMPLETE', status: returning ? 'RETURNING' : 'COMPLETE', returnsAt },
          });
          if (transition.count !== 1) return 'noop';
          await tx.corvetteStrikeReport.create({ data: { missionId: mission.id, attackerId: origin.ownerId, defenderId: target.ownerId, createdAt: currentTime, resolverVersion: canonical.resolverVersion, resultSnapshot: reportSnapshot } });
          await tx.notification.create({ data: { userId: origin.ownerId, type: 'CORVETTE_STRIKE_RESOLVED', message: 'Your Corvette strike result is ready.' } });
          await tx.notification.create({ data: { userId: target.ownerId, type: 'CORVETTE_STRIKE_UNDER_ATTACK', message: 'A Corvette strike reached one of your planets.' } });
          return returning ? 'arrived' : 'arrived';
        }

        if (mission.corvetteStrikePhase !== 'RETURNING' || mission.status !== 'RETURNING' || !mission.returnsAt || mission.returnsAt > currentTime || !existingReport) {
          return mission.corvetteStrikePhase === 'RETURNING' && mission.returnsAt && mission.returnsAt > currentTime ? 'early' : 'noop';
        }
        const survivors = survivorCount(existingReport.resultSnapshot);
        if (survivors === null) return 'noop';
        const transition = await tx.fleetMission.updateMany({ where: { id: mission.id, corvetteStrikePhase: 'RETURNING', status: 'RETURNING' }, data: { corvetteStrikePhase: 'COMPLETE', status: 'COMPLETE' } });
        if (transition.count !== 1) return 'noop';
        if (survivors > 0) await tx.ship.upsert({ where: { planetId_key: { planetId: origin.id, key: 'corvette' } }, update: { count: { increment: survivors } }, create: { planetId: origin.id, key: 'corvette', count: survivors } });
        return 'returned';
      }, { isolationLevel: 'Serializable' });
      if (outcome === 'arrived') await options.scheduleReturnWakeup?.(missionId, currentTime);
      return outcome;
    } catch (error) {
      if (isRetryable(error) && attempt + 1 < ATTEMPTS) continue;
      if (isRetryable(error)) return 'unavailable';
      throw error;
    }
  }
  return 'unavailable';
}
