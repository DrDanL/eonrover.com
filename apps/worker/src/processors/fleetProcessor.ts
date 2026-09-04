import { Job } from 'bullmq';
import {
  CombatUnit,
  DEFENCES,
  DefenceKey,
  PLANET_TYPES,
  SHIPS,
  ShipKey,
  espionageAccuracy,
  resolveCombat,
} from '@eonrover/shared';
import { prisma } from '../prisma';
import { fleetQueue } from '../queues';

interface FleetJobData {
  missionId: string;
}

type ShipCounts = Partial<Record<ShipKey, number>>;

async function techBonus(userId: string, key: string): Promise<number> {
  const row = await prisma.research.findUnique({ where: { userId_key: { userId, key } } });
  return 1 + (row?.level ?? 0) * 0.1;
}

function shipsToCombatUnits(ships: ShipCounts, owner: 'attacker' | 'defender', weaponMult: number, shieldMult: number, armourMult: number): CombatUnit[] {
  const units: CombatUnit[] = [];
  for (const [key, count] of Object.entries(ships)) {
    if (!count) continue;
    const def = SHIPS[key as ShipKey];
    for (let i = 0; i < count; i += 1) {
      units.push({
        id: `${key}-${i}-${Math.random().toString(36).slice(2, 8)}`,
        key: key as ShipKey,
        attack: def.attack * weaponMult,
        shield: def.shield * shieldMult,
        armour: def.armour * armourMult,
        hull: def.armour * armourMult,
        owner,
      });
    }
  }
  return units;
}

function defencesToCombatUnits(defences: ShipCounts, weaponMult: number, shieldMult: number, armourMult: number): CombatUnit[] {
  const units: CombatUnit[] = [];
  for (const [key, count] of Object.entries(defences)) {
    if (!count) continue;
    const def = DEFENCES[key as DefenceKey];
    for (let i = 0; i < count; i += 1) {
      units.push({
        id: `${key}-${i}-${Math.random().toString(36).slice(2, 8)}`,
        key: key as DefenceKey,
        attack: def.attack * weaponMult,
        shield: def.shield * shieldMult,
        armour: def.armour * armourMult,
        hull: def.armour * armourMult,
        owner: 'defender',
      });
    }
  }
  return units;
}

function survivorShipCounts(survivors: CombatUnit[], side: 'attacker' | 'defender'): ShipCounts {
  const counts: ShipCounts = {};
  for (const unit of survivors) {
    if (unit.owner !== side) continue;
    if (!(unit.key in SHIPS)) continue;
    const key = unit.key as ShipKey;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

async function scheduleReturn(missionId: string, ships: ShipCounts, cargo: { alloy: number; heliox: number; aether: number }) {
  const mission = await prisma.fleetMission.findUnique({ where: { id: missionId } });
  if (!mission) return;
  const tripDuration = mission.arrivesAt.getTime() - mission.departedAt.getTime();
  const returnsAt = new Date(Date.now() + Math.max(tripDuration, 5000));
  const updated = await prisma.fleetMission.update({
    where: { id: missionId },
    data: { status: 'RETURNING', ships, cargo, returnsAt },
  });
  const job = await fleetQueue.add(
    'fleet-return',
    { missionId },
    { delay: Math.max(0, returnsAt.getTime() - Date.now()), removeOnComplete: true, attempts: 3 },
  );
  await prisma.fleetMission.update({ where: { id: missionId }, data: { jobId: job.id } });
  return updated;
}

async function handleArrival(mission: NonNullable<Awaited<ReturnType<typeof loadMission>>>) {
  const ships = (mission.ships as ShipCounts) ?? {};
  const cargo = (mission.cargo as { alloy: number; heliox: number; aether: number }) ?? {
    alloy: 0,
    heliox: 0,
    aether: 0,
  };

  switch (mission.missionType) {
    case 'TRANSPORT': {
      if (mission.target) {
        await prisma.planet.update({
          where: { id: mission.target.id },
          data: {
            alloy: { increment: cargo.alloy },
            heliox: { increment: cargo.heliox },
            aether: { increment: cargo.aether },
          },
        });
      }
      await scheduleReturn(mission.id, ships, { alloy: 0, heliox: 0, aether: 0 });
      return;
    }
    case 'DEPLOY':
    case 'GATE_TRAVEL': {
      if (mission.target) {
        await prisma.$transaction(async (tx) => {
          for (const [key, count] of Object.entries(ships)) {
            if (!count) continue;
            await tx.ship.upsert({
              where: { planetId_key: { planetId: mission.target!.id, key } },
              update: { count: { increment: count } },
              create: { planetId: mission.target!.id, key, count },
            });
          }
          await tx.planet.update({
            where: { id: mission.target!.id },
            data: {
              alloy: { increment: cargo.alloy },
              heliox: { increment: cargo.heliox },
              aether: { increment: cargo.aether },
            },
          });
        });
      }
      await prisma.fleetMission.update({ where: { id: mission.id }, data: { status: 'COMPLETE' } });
      return;
    }
    case 'ESPIONAGE': {
      if (mission.target) {
        const [attackerLevel, defenderLevel, buildings, targetShips, defences] = await Promise.all([
          prisma.research.findUnique({ where: { userId_key: { userId: mission.origin.ownerId, key: 'espionageTech' } } }),
          prisma.research.findUnique({ where: { userId_key: { userId: mission.target.ownerId, key: 'espionageTech' } } }),
          prisma.building.findMany({ where: { planetId: mission.target.id } }),
          prisma.ship.findMany({ where: { planetId: mission.target.id } }),
          prisma.defence.findMany({ where: { planetId: mission.target.id } }),
        ]);
        const accuracy = espionageAccuracy(attackerLevel?.level ?? 0, defenderLevel?.level ?? 0);
        await prisma.espionageReport.create({
          data: {
            missionId: mission.id,
            ownerId: mission.origin.ownerId,
            targetPlanetId: mission.target.id,
            accuracy,
            data: {
              resources: { alloy: mission.target.alloy, heliox: mission.target.heliox, aether: mission.target.aether },
              buildings: Object.fromEntries(buildings.map((b) => [b.key, b.level])),
              ships: Object.fromEntries(targetShips.map((s) => [s.key, s.count])),
              defences: Object.fromEntries(defences.map((d) => [d.key, d.count])),
            },
          },
        });
        await prisma.notification.create({
          data: { userId: mission.target.ownerId, type: 'ESPIONAGE_DETECTED', message: 'An unknown probe scanned one of your planets.' },
        });
      }
      await scheduleReturn(mission.id, ships, { alloy: 0, heliox: 0, aether: 0 });
      return;
    }
    case 'ATTACK':
    case 'RAID': {
      if (!mission.target) {
        await scheduleReturn(mission.id, ships, cargo);
        return;
      }
      const [attWeapon, attShield, attArmour, defWeapon, defShield, defArmour, targetShips, targetDefences] = await Promise.all([
        techBonus(mission.origin.ownerId, 'weaponTech'),
        techBonus(mission.origin.ownerId, 'shieldTech'),
        techBonus(mission.origin.ownerId, 'armourTech'),
        techBonus(mission.target.ownerId, 'weaponTech'),
        techBonus(mission.target.ownerId, 'shieldTech'),
        techBonus(mission.target.ownerId, 'armourTech'),
        prisma.ship.findMany({ where: { planetId: mission.target.id } }),
        prisma.defence.findMany({ where: { planetId: mission.target.id } }),
      ]);

      const attackers = shipsToCombatUnits(ships, 'attacker', attWeapon, attShield, attArmour);
      const defenders = [
        ...shipsToCombatUnits(Object.fromEntries(targetShips.map((s) => [s.key, s.count])), 'defender', defWeapon, defShield, defArmour),
        ...defencesToCombatUnits(Object.fromEntries(targetDefences.map((d) => [d.key, d.count])), defWeapon, defShield, defArmour),
      ];

      const result = resolveCombat(attackers, defenders);

      await prisma.combatReport.create({
        data: {
          missionId: mission.id,
          attackerId: mission.origin.ownerId,
          defenderId: mission.target.ownerId,
          planetId: mission.target.id,
          outcome: result.outcome,
          rounds: result.rounds as never,
          debris: result.debris as never,
        },
      });

      const survivingDefenderShips = survivorShipCounts(result.survivorsDefender, 'defender');
      const survivingDefenderDefenceUnits = result.survivorsDefender.filter((u) => u.key in DEFENCES);
      const defenceCounts: Record<string, number> = {};
      for (const unit of survivingDefenderDefenceUnits) defenceCounts[unit.key] = (defenceCounts[unit.key] ?? 0) + 1;

      await prisma.$transaction(async (tx) => {
        for (const key of Object.keys(SHIPS)) {
          await tx.ship
            .update({ where: { planetId_key: { planetId: mission.target!.id, key } }, data: { count: survivingDefenderShips[key as ShipKey] ?? 0 } })
            .catch(() => undefined);
        }
        for (const key of Object.keys(DEFENCES)) {
          await tx.defence
            .update({ where: { planetId_key: { planetId: mission.target!.id, key } }, data: { count: defenceCounts[key] ?? 0 } })
            .catch(() => undefined);
        }
        if (result.debris.alloy > 0 || result.debris.heliox > 0) {
          await tx.debrisField.upsert({
            where: { planetId: mission.target!.id },
            update: { alloy: { increment: result.debris.alloy }, heliox: { increment: result.debris.heliox } },
            create: { planetId: mission.target!.id, alloy: result.debris.alloy, heliox: result.debris.heliox },
          });
        }
      });

      let loot = { alloy: 0, heliox: 0, aether: 0 };
      const survivingAttackerShips = survivorShipCounts(result.survivorsAttacker, 'attacker');
      if (result.outcome === 'attacker') {
        const cargoCapacity = Object.entries(survivingAttackerShips).reduce(
          (sum, [key, count]) => sum + SHIPS[key as ShipKey].cargo * (count ?? 0),
          0,
        );
        const targetFresh = await prisma.planet.findUnique({ where: { id: mission.target.id } });
        const lootShare = 0.5;
        const rawAlloy = Math.min((targetFresh?.alloy ?? 0) * lootShare, cargoCapacity);
        const remainingCapacity = cargoCapacity - rawAlloy;
        const rawHeliox = Math.min((targetFresh?.heliox ?? 0) * lootShare, remainingCapacity);
        const remainingCapacity2 = remainingCapacity - rawHeliox;
        const rawAether = Math.min((targetFresh?.aether ?? 0) * lootShare, remainingCapacity2);
        loot = { alloy: Math.round(rawAlloy), heliox: Math.round(rawHeliox), aether: Math.round(rawAether) };
        await prisma.planet.update({
          where: { id: mission.target.id },
          data: { alloy: { decrement: loot.alloy }, heliox: { decrement: loot.heliox }, aether: { decrement: loot.aether } },
        });
      }
      await prisma.notification.create({
        data: {
          userId: mission.target.ownerId,
          type: 'UNDER_ATTACK',
          message: `${mission.missionType === 'RAID' ? 'A raid' : 'An attack'} on ${mission.target.name} resulted in a ${result.outcome === 'attacker' ? 'defeat' : result.outcome === 'defender' ? 'successful defence' : 'draw'}.`,
        },
      });

      await scheduleReturn(mission.id, survivingAttackerShips, loot);
      return;
    }
    case 'RECYCLE': {
      if (mission.target) {
        const debris = await prisma.debrisField.findUnique({ where: { planetId: mission.target.id } });
        if (debris) {
          const cargoCapacity = Object.entries(ships).reduce(
            (sum, [key, count]) => sum + SHIPS[key as ShipKey].cargo * (count ?? 0),
            0,
          );
          const alloy = Math.min(debris.alloy, cargoCapacity);
          const heliox = Math.min(debris.heliox, cargoCapacity - alloy);
          await prisma.debrisField.update({
            where: { id: debris.id },
            data: { alloy: { decrement: alloy }, heliox: { decrement: heliox } },
          });
          await scheduleReturn(mission.id, ships, { alloy, heliox, aether: 0 });
          return;
        }
      }
      await scheduleReturn(mission.id, ships, { alloy: 0, heliox: 0, aether: 0 });
      return;
    }
    case 'COLONIZE': {
      const remainingShips: ShipCounts = { ...ships };
      const hadColonyShip = (remainingShips.colonyShip ?? 0) > 0;
      if (hadColonyShip) delete remainingShips.colonyShip;

      if (!mission.target && hadColonyShip) {
        const galaxy = mission.targetGalaxy;
        const system = mission.targetSystem;
        const slot = mission.targetSlot;
        const collision = await prisma.planet.findUnique({ where: { galaxy_system_slot: { galaxy, system, slot } } });
        if (!collision) {
          const planetTypeKeys = Object.keys(PLANET_TYPES) as Array<keyof typeof PLANET_TYPES>;
          const chosen = planetTypeKeys[Math.floor(Math.random() * planetTypeKeys.length)];
          const profile = PLANET_TYPES[chosen];
          const planetTypeToDb: Record<string, string> = {
            temperate: 'TEMPERATE',
            volcanic: 'VOLCANIC',
            ice: 'ICE',
            gasGiant: 'GAS_GIANT',
            barren: 'BARREN',
            oceanic: 'OCEANIC',
          };
          await prisma.planet.create({
            data: {
              ownerId: mission.origin.ownerId,
              name: 'New Colony',
              galaxy,
              system,
              slot,
              planetType: planetTypeToDb[chosen] as never,
              temperature: Math.round(profile.temperatureRange[0] + Math.random() * (profile.temperatureRange[1] - profile.temperatureRange[0])),
              solarIndex: profile.solarIndexRange[0] + Math.random() * (profile.solarIndexRange[1] - profile.solarIndexRange[0]),
              buildings: { create: [{ key: 'solarArray', level: 1 }] },
            },
          });
          await prisma.notification.create({
            data: { userId: mission.origin.ownerId, type: 'COLONY_FOUNDED', message: 'A new colony has been founded.' },
          });
        } else {
          // Slot filled while in flight — colony ship and escort return home instead.
          remainingShips.colonyShip = 1;
        }
      }
      if (Object.keys(remainingShips).length > 0) {
        await scheduleReturn(mission.id, remainingShips, { alloy: 0, heliox: 0, aether: 0 });
      } else {
        await prisma.fleetMission.update({ where: { id: mission.id }, data: { status: 'COMPLETE' } });
      }
      return;
    }
    case 'EXPLORE': {
      const discovered = Math.random() < 0.2;
      if (discovered) {
        await prisma.gateFragment.create({
          data: {
            ownerId: mission.origin.ownerId,
            planetId: mission.origin.id,
            fragmentKey: `fragment-${Math.floor(Math.random() * 1000)}`,
          },
        });
        await prisma.notification.create({
          data: { userId: mission.origin.ownerId, type: 'GATE_FRAGMENT_FOUND', message: 'Your explorers recovered an Eon Gate fragment!' },
        });
      }
      await scheduleReturn(mission.id, ships, { alloy: 0, heliox: 0, aether: 0 });
      return;
    }
    default:
      await scheduleReturn(mission.id, ships, cargo);
  }
}

async function loadMission(missionId: string) {
  return prisma.fleetMission.findUnique({ where: { id: missionId }, include: { origin: true, target: true } });
}

async function handleReturn(missionId: string) {
  const mission = await loadMission(missionId);
  if (!mission) return;
  const ships = (mission.ships as ShipCounts) ?? {};
  const cargo = (mission.cargo as { alloy: number; heliox: number; aether: number }) ?? {
    alloy: 0,
    heliox: 0,
    aether: 0,
  };
  await prisma.$transaction(async (tx) => {
    for (const [key, count] of Object.entries(ships)) {
      if (!count) continue;
      await tx.ship.upsert({
        where: { planetId_key: { planetId: mission.originId, key } },
        update: { count: { increment: count } },
        create: { planetId: mission.originId, key, count },
      });
    }
    await tx.planet.update({
      where: { id: mission.originId },
      data: {
        alloy: { increment: cargo.alloy },
        heliox: { increment: cargo.heliox },
        aether: { increment: cargo.aether },
      },
    });
    await tx.fleetMission.update({ where: { id: mission.id }, data: { status: 'COMPLETE' } });
  });
}

export async function processFleetJob(job: Job<FleetJobData>): Promise<void> {
  const mission = await loadMission(job.data.missionId);
  if (!mission) return;

  if (job.name === 'fleet-return' || mission.status === 'RETURNING' || mission.status === 'RECALLED') {
    await handleReturn(job.data.missionId);
    return;
  }
  if (mission.status !== 'OUTBOUND') return;
  await handleArrival(mission);
}
