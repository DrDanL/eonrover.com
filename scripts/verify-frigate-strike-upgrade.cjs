/* Physical Stage 16B replay: real pre-Stage-16 migration directories, raw pre-schema rows, then the real final migration. */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const root = path.resolve(__dirname, '..');
const url = process.env.UPGRADE_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('UPGRADE_DATABASE_URL must name an isolated _test database.');
const migrations = path.join(root, 'apps/api/prisma/migrations');
const finalMigration = '20260916000000_add_frigate_strike_snapshots';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'eonrover-frigate-upgrade-'));
const tempPrisma = path.join(temp, 'prisma');
fs.mkdirSync(path.join(tempPrisma, 'migrations'), { recursive: true });
fs.copyFileSync(path.join(root, 'apps/api/prisma/schema.prisma'), path.join(tempPrisma, 'schema.prisma'));
fs.copyFileSync(path.join(migrations, 'migration_lock.toml'), path.join(tempPrisma, 'migrations/migration_lock.toml'));
for (const entry of fs.readdirSync(migrations)) if (entry < finalMigration && fs.statSync(path.join(migrations, entry)).isDirectory()) fs.cpSync(path.join(migrations, entry), path.join(tempPrisma, 'migrations', entry), { recursive: true });
function migrate(schema) { execFileSync('npx', ['prisma', 'migrate', 'deploy', '--schema', schema], { cwd: root, env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' }); }
const db = new PrismaClient({ datasources: { db: { url } } });
const sql = (text) => db.$executeRawUnsafe(text);
const rows = (text) => db.$queryRawUnsafe(text);
async function main() {
  try {
    migrate(path.join(tempPrisma, 'schema.prisma'));
    const updated = "'2026-12-01T00:00:00.000Z'::timestamp";
    await sql(`INSERT INTO "User" ("id","email","username","passwordHash","status","emailVerifiedAt","updatedAt") VALUES ('u-a','a@upgrade.invalid','upgrade-a','x','ACTIVE',${updated},${updated}),('u-d','d@upgrade.invalid','upgrade-d','x','ACTIVE',${updated},${updated})`);
    await sql(`INSERT INTO "Planet" ("id","ownerId","name","galaxy","system","slot","planetType","temperature","solarIndex","lastProductionAt","updatedAt") VALUES ('p-a','u-a','Origin',1,55,1,'TEMPERATE',10,0.7,${updated},${updated}),('p-d','u-d','Target',1,55,2,'TEMPERATE',10,0.7,${updated},${updated})`);
    await sql(`INSERT INTO "Ship" ("id","planetId","key","count") VALUES ('s-frigate','p-a','frigate',3),('s-corvette','p-d','corvette',2)`);
    await sql(`INSERT INTO "Defence" ("id","planetId","key","count") VALUES ('d-flak','p-d','flakTurret',2),('d-rail','p-d','railBattery',1)`);
    await sql(`INSERT INTO "ShipyardQueueItem" ("id","planetId","itemKey","itemType","quantity","remaining","completesAt","status","jobId") VALUES ('q-legacy','p-a','legacy-item','ship',2,2,${updated},'PENDING','legacy-job')`);
    const missionValues = `(originId,targetId,targetGalaxy,targetSystem,targetSlot,missionType,ships,cargo,speedPercent,departedAt,arrivesAt,returnsAt,status)`;
    await sql(`INSERT INTO "FleetMission" ${missionValues} VALUES ('p-a','p-d',1,55,2,'ATTACK','{}','{}',100,${updated},${updated},${updated},'OUTBOUND')`);
    await sql(`INSERT INTO "FleetMission" ${missionValues} VALUES ('p-a','p-d',1,55,2,'ATTACK','{"corvette":2}','{}',100,${updated},${updated},${updated},'OUTBOUND')`);
    const corvette = await rows(`SELECT "id" FROM "FleetMission" WHERE "corvetteStrikeOriginPlanetId" IS NULL ORDER BY "id" DESC LIMIT 1`);
    // The last row is promoted using actual pre-16 canonical Corvette columns.
    const corvetteId = corvette[0].id;
    await sql(`UPDATE "FleetMission" SET "corvetteStrikeOriginPlanetId"='p-a',"corvetteStrikeTargetPlanetId"='p-d',"corvetteStrikeAttackerId"='u-a',"corvetteStrikeDefenderId"='u-d',"corvetteStrikeShips"='{"corvette":2}',"corvetteStrikeOutboundFuelHeliox"=1,"corvetteStrikeReturnFuelHeliox"=1,"corvetteStrikeOutboundDurationSeconds"=60,"corvetteStrikeReturnDurationSeconds"=60,"corvetteStrikeResolverVersion"='corvette-strike-v2',"corvetteStrikeResolverSeed"='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',"corvetteStrikeAttackerTechnology"='{"weaponTech":0,"shieldTech":0,"armourTech":0}',"corvetteStrikePhase"='OUTBOUND' WHERE "id"='${corvetteId}'`);
    await sql(`INSERT INTO "CorvetteStrikeReport" ("id","missionId","attackerId","defenderId","createdAt","resolverVersion","resultSnapshot") VALUES ('r-corvette','${corvetteId}','u-a','u-d',${updated},'corvette-strike-v2','{"legacy":true}')`);
    const before = await rows(`SELECT "id","ships","cargo","speedPercent","status","jobId","resultSummary","corvetteStrikePhase","corvetteStrikeResolverVersion" FROM "FleetMission" ORDER BY "id"`);
    const inventoryBefore = await rows(`SELECT 'Ship' AS kind,"id","planetId","key","count" FROM "Ship" UNION ALL SELECT 'Defence',"id","planetId","key","count" FROM "Defence" ORDER BY kind,"id"`);
    migrate(path.join(root, 'apps/api/prisma/schema.prisma'));
    migrate(path.join(root, 'apps/api/prisma/schema.prisma'));
    const after = await rows(`SELECT "id","ships","cargo","speedPercent","status","jobId","resultSummary","corvetteStrikePhase","corvetteStrikeResolverVersion","frigateStrikeOriginPlanetId","frigateStrikeTargetPlanetId","frigateStrikeAttackerId","frigateStrikeDefenderId","frigateStrikeShips","frigateStrikePhase" FROM "FleetMission" ORDER BY "id"`);
    assert.deepEqual(after.map(({ frigateStrikeOriginPlanetId, frigateStrikeTargetPlanetId, frigateStrikeAttackerId, frigateStrikeDefenderId, frigateStrikeShips, frigateStrikePhase, ...legacy }) => legacy), before);
    assert.ok(after.every((row) => row.frigateStrikeOriginPlanetId === null && row.frigateStrikeTargetPlanetId === null && row.frigateStrikeAttackerId === null && row.frigateStrikeDefenderId === null && row.frigateStrikeShips === null && row.frigateStrikePhase === null));
    assert.deepEqual(await rows(`SELECT 'Ship' AS kind,"id","planetId","key","count" FROM "Ship" UNION ALL SELECT 'Defence',"id","planetId","key","count" FROM "Defence" ORDER BY kind,"id"`), inventoryBefore);
    assert.equal((await rows(`SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE "migration_name"='${finalMigration}'`))[0].count, 1);
    const names = (await rows(`SELECT indexname FROM pg_indexes WHERE tablename IN ('FleetMission','FrigateStrikeReport') AND indexname LIKE '%frigate%'`)).map((row) => row.indexname);
    for (const name of ['FleetMission_one_active_canonical_frigate_strike_per_origin','FleetMission_frigateStrikePhase_arrivesAt_idx','FleetMission_frigateStrikePhase_returnsAt_idx','FrigateStrikeReport_missionId_key']) assert.ok(names.includes(name), name);
    const insertFrigate = (id, phase) => sql(`INSERT INTO "FleetMission" ("id","originId","targetId","targetGalaxy","targetSystem","targetSlot","missionType","ships","cargo","speedPercent","departedAt","arrivesAt","returnsAt","status","frigateStrikeOriginPlanetId","frigateStrikeTargetPlanetId","frigateStrikeAttackerId","frigateStrikeDefenderId","frigateStrikeShips","frigateStrikeOutboundFuelHeliox","frigateStrikeReturnFuelHeliox","frigateStrikeOutboundDurationSeconds","frigateStrikeReturnDurationSeconds","frigateStrikeResolverVersion","frigateStrikeResolverSeed","frigateStrikeAttackerTechnology","frigateStrikePhase") VALUES ('${id}','p-a','p-d',1,55,2,'ATTACK','{}','{}',100,${updated},${updated},${updated},'${phase}','p-a','p-d','u-a','u-d','{"frigate":1}',1,1,60,60,'frigate-strike-v1','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','{"weaponTech":0,"shieldTech":0,"armourTech":0}','${phase}')`);
    await insertFrigate('f-active', 'OUTBOUND'); await assert.rejects(insertFrigate('f-blocked', 'RETURNING')); await sql(`UPDATE "FleetMission" SET "status"='COMPLETE',"frigateStrikePhase"='COMPLETE' WHERE "id"='f-active'`); await insertFrigate('f-next', 'OUTBOUND');
    process.stdout.write('Physical Frigate upgrade replay passed.\n');
  } finally { await db.$disconnect(); fs.rmSync(temp, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
