const {
  configureTestDatabaseEnvironment,
  runDestructiveTestDatabaseOperation,
} = require('../../../test/databaseSafety.cjs') as {
  configureTestDatabaseEnvironment: (environment: NodeJS.ProcessEnv) => unknown;
  runDestructiveTestDatabaseOperation: <T>(environment: NodeJS.ProcessEnv, operation: () => T) => T;
};

// This repeats the pre-Jest setup guard before requiring the Prisma module, so
// this file is safe even if it is executed outside the expected Jest config.
configureTestDatabaseEnvironment(process.env);
const { prisma } = require('./prisma') as typeof import('./prisma');

beforeEach(async () => {
  await runDestructiveTestDatabaseOperation(process.env, async () => {
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
});

afterAll(async () => {
  await prisma.$disconnect();
});
