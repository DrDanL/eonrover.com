import { prisma } from './prisma';

export const hasTestDatabase = Boolean(process.env.DATABASE_URL);

beforeEach(async () => {
  if (!hasTestDatabase) return;
  // Clean tables between tests, respecting FK order (children first).
  await prisma.$transaction([
    prisma.combatReport.deleteMany(),
    prisma.espionageReport.deleteMany(),
    prisma.debrisField.deleteMany(),
    prisma.fleetMission.deleteMany(),
    prisma.shipyardQueueItem.deleteMany(),
    prisma.researchQueueItem.deleteMany(),
    prisma.buildQueueItem.deleteMany(),
    prisma.ship.deleteMany(),
    prisma.defence.deleteMany(),
    prisma.building.deleteMany(),
    prisma.research.deleteMany(),
    prisma.gateFragment.deleteMany(),
    prisma.eonGate.deleteMany(),
    prisma.planet.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.message.deleteMany(),
    prisma.allianceMember.deleteMany(),
    prisma.alliance.deleteMany(),
    prisma.announcement.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.securityEvent.deleteMany(),
    prisma.verificationToken.deleteMany(),
    prisma.session.deleteMany(),
    prisma.universeSetting.deleteMany(),
    prisma.user.deleteMany(),
  ]);
});

afterAll(async () => {
  if (hasTestDatabase) await prisma.$disconnect();
});
