import { DEFENCES, SHIPS } from './constants';
import { FRIGATE_STRIKE_RESOLVER_VERSION, resolveFrigateStrike } from './frigateStrike';

const ATTEMPTS = 3;
export type FrigateStrikeCompletionOutcome = 'arrived' | 'returned' | 'early' | 'noop' | 'unavailable';
export interface FrigateStrikeCompletionDatabase { $transaction<T>(callback: (transaction: any) => Promise<T>, options?: unknown): Promise<T>; }
export interface FrigateStrikeCompletionOptions { scheduleReturnWakeup?: (missionId: string, currentTime: Date) => Promise<unknown>; }
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function manifest(value: unknown): { frigate: number } | null { return record(value) && Object.keys(value).join(',') === 'frigate' && whole(value.frigate) && value.frigate > 0 && value.frigate <= 100 ? { frigate: value.frigate } : null; }
function technology(value: unknown): { weaponTech: number; shieldTech: number; armourTech: number } | null { return record(value) && Object.keys(value).sort().join(',') === 'armourTech,shieldTech,weaponTech' && whole(value.weaponTech) && whole(value.shieldTech) && whole(value.armourTech) ? value as { weaponTech: number; shieldTech: number; armourTech: number } : null; }
function canonical(mission: any) {
  const ships = manifest(mission?.frigateStrikeShips); const attackerTechnology = technology(mission?.frigateStrikeAttackerTechnology);
  if (!ships || !attackerTechnology || mission?.missionType !== 'ATTACK' || mission.frigateStrikeResolverVersion !== FRIGATE_STRIKE_RESOLVER_VERSION || typeof mission.frigateStrikeResolverSeed !== 'string' || !mission.frigateStrikeResolverSeed || !whole(mission.frigateStrikeOutboundFuelHeliox) || !whole(mission.frigateStrikeReturnFuelHeliox) || !Number.isSafeInteger(mission.frigateStrikeOutboundDurationSeconds) || mission.frigateStrikeOutboundDurationSeconds <= 0 || !Number.isSafeInteger(mission.frigateStrikeReturnDurationSeconds) || mission.frigateStrikeReturnDurationSeconds <= 0 || mission.speedPercent !== 100 || !mission.departedAt || !mission.arrivesAt || mission.arrivesAt.getTime() - mission.departedAt.getTime() !== mission.frigateStrikeOutboundDurationSeconds * 1000) return null;
  return { ships, attackerTechnology };
}
function quantities(rows: Array<{ key: string; count: number }>, definitions: Record<string, unknown>) { const result: Record<string, number> = {}; for (const row of rows) if (row.key in definitions && whole(row.count) && row.count > 0) result[row.key] = row.count; return result; }
function defenderTechnology(rows: Array<{ key: string; level: number }>) { const levels = new Map(rows.map((row) => [row.key, row.level])); return { weaponTech: levels.get('weaponTech') ?? 0, shieldTech: levels.get('shieldTech') ?? 0, armourTech: levels.get('armourTech') ?? 0 }; }
function survivorCount(snapshot: unknown): number | null { const value = record(snapshot) && record(snapshot.survivors) && record(snapshot.survivors.attacker) ? snapshot.survivors.attacker.frigate : undefined; return whole(value) ? value : null; }
const retryable = (error: any) => error?.code === 'P2034' || (error?.code === 'P2010' && error?.meta?.code === '40001');
/** Settles only canonical Frigate rows; generic ATTACK data and job payloads are never authority. */
export async function settleCanonicalFrigateStrike(database: FrigateStrikeCompletionDatabase, missionId: string, currentTime = new Date(), options: FrigateStrikeCompletionOptions = {}): Promise<FrigateStrikeCompletionOutcome> {
  if (!missionId || !Number.isFinite(currentTime.getTime())) return 'noop';
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) try {
    const outcome = await database.$transaction(async (tx) => {
      // sorted accounts → origin → target → target ships/defences → mission → report
      const accounts = await tx.$queryRaw<Array<{ id: string }>>`SELECT account."id" AS "id" FROM "User" account WHERE account."id" IN (SELECT "frigateStrikeAttackerId" FROM "FleetMission" WHERE "id"=${missionId} UNION SELECT "frigateStrikeDefenderId" FROM "FleetMission" WHERE "id"=${missionId}) ORDER BY account."id" FOR UPDATE`;
      if (accounts.length !== 2 || accounts[0].id === accounts[1].id) return 'noop';
      const originRows = await tx.$queryRaw<Array<{ id: string }>>`SELECT planet."id" AS "id" FROM "Planet" planet JOIN "FleetMission" mission ON mission."frigateStrikeOriginPlanetId"=planet."id" WHERE mission."id"=${missionId} FOR UPDATE OF planet`;
      const targetRows = await tx.$queryRaw<Array<{ id: string }>>`SELECT planet."id" AS "id" FROM "Planet" planet JOIN "FleetMission" mission ON mission."frigateStrikeTargetPlanetId"=planet."id" WHERE mission."id"=${missionId} FOR UPDATE OF planet`;
      if (originRows.length !== 1 || targetRows.length !== 1) return 'noop';
      const origin = await tx.planet.findUnique({ where: { id: originRows[0].id } }); const target = await tx.planet.findUnique({ where: { id: targetRows[0].id } });
      if (!origin || !target || origin.ownerId === target.ownerId) return 'noop';
      await tx.$queryRaw`SELECT "id" FROM "Ship" WHERE "planetId"=${target.id} FOR UPDATE`; await tx.$queryRaw`SELECT "id" FROM "Defence" WHERE "planetId"=${target.id} FOR UPDATE`; await tx.$queryRaw`SELECT "id" FROM "FleetMission" WHERE "id"=${missionId} FOR UPDATE`;
      const mission = await tx.fleetMission.findUnique({ where: { id: missionId } });
      if (!mission || mission.frigateStrikeOriginPlanetId !== origin.id || mission.frigateStrikeTargetPlanetId !== target.id || mission.frigateStrikeAttackerId !== origin.ownerId || mission.frigateStrikeDefenderId !== target.ownerId || mission.originId !== origin.id || mission.targetId !== target.id || mission.targetGalaxy !== target.galaxy || mission.targetSystem !== target.system || mission.targetSlot !== target.slot) return 'noop';
      const accepted = canonical(mission); if (!accepted) return 'noop'; await tx.$queryRaw`SELECT "id" FROM "FrigateStrikeReport" WHERE "missionId"=${missionId} FOR UPDATE`; const report = await tx.frigateStrikeReport.findUnique({ where: { missionId } });
      if (mission.frigateStrikePhase === 'OUTBOUND' && mission.status === 'OUTBOUND') {
        if (mission.arrivesAt > currentTime) return 'early'; if (report) return 'noop';
        const [ships, defences, research] = await Promise.all([tx.ship.findMany({ where: { planetId: target.id }, select: { key: true, count: true } }), tx.defence.findMany({ where: { planetId: target.id }, select: { key: true, count: true } }), tx.research.findMany({ where: { userId: target.ownerId, key: { in: ['weaponTech', 'shieldTech', 'armourTech'] } }, select: { key: true, level: true } })]);
        const result = resolveFrigateStrike({ version: FRIGATE_STRIKE_RESOLVER_VERSION, seed: mission.frigateStrikeResolverSeed, attacker: { frigates: accepted.ships.frigate, technology: accepted.attackerTechnology }, defender: { ships: quantities(ships, SHIPS), defences: quantities(defences, DEFENCES), technology: defenderTechnology(research) } });
        for (const [key, count] of Object.entries(result.losses.defender)) { if (count > 0 && key in SHIPS) await tx.ship.updateMany({ where: { planetId: target.id, key, count: { gte: count } }, data: { count: { decrement: count } } }); if (count > 0 && key in DEFENCES) await tx.defence.updateMany({ where: { planetId: target.id, key, count: { gte: count } }, data: { count: { decrement: count } } }); }
        const survivors = result.survivors.attacker.frigate ?? 0; const returning = survivors > 0; const returnsAt = returning ? new Date(currentTime.getTime() + mission.frigateStrikeReturnDurationSeconds * 1000) : mission.returnsAt;
        const transitioned = await tx.fleetMission.updateMany({ where: { id: mission.id, frigateStrikePhase: 'OUTBOUND', status: 'OUTBOUND' }, data: { frigateStrikePhase: returning ? 'RETURNING' : 'COMPLETE', status: returning ? 'RETURNING' : 'COMPLETE', returnsAt } }); if (transitioned.count !== 1) return 'noop';
        const snapshot = { target: { coordinates: { galaxy: target.galaxy, system: target.system, slot: target.slot }, planet: { name: target.name, type: target.planetType } }, outcome: result.outcome, starting: result.starting, survivors: result.survivors, losses: result.losses, rounds: result.rounds, resolution: result.termination };
        await tx.frigateStrikeReport.create({ data: { missionId: mission.id, attackerId: origin.ownerId, defenderId: target.ownerId, createdAt: currentTime, resolverVersion: FRIGATE_STRIKE_RESOLVER_VERSION, resultSnapshot: snapshot } });
        await tx.notification.create({ data: { userId: origin.ownerId, type: 'CORVETTE_STRIKE_RESOLVED', message: 'Your Frigate strike result is ready.' } });
        await tx.notification.create({ data: { userId: target.ownerId, type: 'CORVETTE_STRIKE_UNDER_ATTACK', message: 'A Frigate strike reached one of your planets.' } });
        return 'arrived';
      }
      if (mission.frigateStrikePhase !== 'RETURNING' || mission.status !== 'RETURNING' || !mission.returnsAt || mission.returnsAt > currentTime || !report) return mission.frigateStrikePhase === 'RETURNING' && mission.returnsAt && mission.returnsAt > currentTime ? 'early' : 'noop';
      const survivors = survivorCount(report.resultSnapshot); if (survivors === null) return 'noop'; const transitioned = await tx.fleetMission.updateMany({ where: { id: mission.id, frigateStrikePhase: 'RETURNING', status: 'RETURNING' }, data: { frigateStrikePhase: 'COMPLETE', status: 'COMPLETE' } }); if (transitioned.count !== 1) return 'noop'; if (survivors > 0) await tx.ship.upsert({ where: { planetId_key: { planetId: origin.id, key: 'frigate' } }, update: { count: { increment: survivors } }, create: { planetId: origin.id, key: 'frigate', count: survivors } }); return 'returned';
    }, { isolationLevel: 'Serializable' });
    if (outcome === 'arrived') await options.scheduleReturnWakeup?.(missionId, currentTime); return outcome;
  } catch (error) { if (retryable(error) && attempt + 1 < ATTEMPTS) continue; if (retryable(error)) return 'unavailable'; throw error; }
  return 'unavailable';
}
