-- CreateEnum
CREATE TYPE "AccountRole" AS ENUM ('PLAYER', 'MODERATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'BANNED');

-- CreateEnum
CREATE TYPE "VerificationTokenType" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "PlanetType" AS ENUM ('TEMPERATE', 'VOLCANIC', 'ICE', 'GAS_GIANT', 'BARREN', 'OCEANIC');

-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('PENDING', 'COMPLETE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MissionType" AS ENUM ('TRANSPORT', 'DEPLOY', 'ESPIONAGE', 'ATTACK', 'RAID', 'RECYCLE', 'COLONIZE', 'EXPLORE', 'RETURN');

-- CreateEnum
CREATE TYPE "MissionStatus" AS ENUM ('OUTBOUND', 'RETURNING', 'COMPLETE', 'RECALLED');

-- CreateEnum
CREATE TYPE "AllianceRank" AS ENUM ('LEADER', 'OFFICER', 'MEMBER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "AccountRole" NOT NULL DEFAULT 'PLAYER',
    "status" "AccountStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "emailVerifiedAt" TIMESTAMP(3),
    "protectedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "lastActiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "type" "VerificationTokenType" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Planet" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isHomeworld" BOOLEAN NOT NULL DEFAULT false,
    "galaxy" INTEGER NOT NULL,
    "system" INTEGER NOT NULL,
    "slot" INTEGER NOT NULL,
    "planetType" "PlanetType" NOT NULL,
    "temperature" INTEGER NOT NULL,
    "solarIndex" DOUBLE PRECISION NOT NULL,
    "alloy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "heliox" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "aether" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastProductionAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Planet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Building" (
    "id" TEXT NOT NULL,
    "planetId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Building_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuildQueueItem" (
    "id" TEXT NOT NULL,
    "planetId" TEXT NOT NULL,
    "buildingKey" TEXT NOT NULL,
    "targetLevel" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completesAt" TIMESTAMP(3) NOT NULL,
    "status" "QueueStatus" NOT NULL DEFAULT 'PENDING',
    "jobId" TEXT,

    CONSTRAINT "BuildQueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Research" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Research_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchQueueItem" (
    "id" TEXT NOT NULL,
    "planetId" TEXT NOT NULL,
    "researchKey" TEXT NOT NULL,
    "targetLevel" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completesAt" TIMESTAMP(3) NOT NULL,
    "status" "QueueStatus" NOT NULL DEFAULT 'PENDING',
    "jobId" TEXT,

    CONSTRAINT "ResearchQueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ship" (
    "id" TEXT NOT NULL,
    "planetId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Ship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipyardQueueItem" (
    "id" TEXT NOT NULL,
    "planetId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completesAt" TIMESTAMP(3) NOT NULL,
    "status" "QueueStatus" NOT NULL DEFAULT 'PENDING',
    "jobId" TEXT,

    CONSTRAINT "ShipyardQueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Defence" (
    "id" TEXT NOT NULL,
    "planetId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Defence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetMission" (
    "id" TEXT NOT NULL,
    "originId" TEXT NOT NULL,
    "targetId" TEXT,
    "targetGalaxy" INTEGER NOT NULL,
    "targetSystem" INTEGER NOT NULL,
    "targetSlot" INTEGER NOT NULL,
    "missionType" "MissionType" NOT NULL,
    "ships" JSONB NOT NULL,
    "cargo" JSONB NOT NULL,
    "speedPercent" INTEGER NOT NULL DEFAULT 100,
    "departedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "arrivesAt" TIMESTAMP(3) NOT NULL,
    "returnsAt" TIMESTAMP(3),
    "status" "MissionStatus" NOT NULL DEFAULT 'OUTBOUND',
    "jobId" TEXT,
    "resultSummary" JSONB,

    CONSTRAINT "FleetMission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CombatReport" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "attackerId" TEXT NOT NULL,
    "defenderId" TEXT,
    "planetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT NOT NULL,
    "rounds" JSONB NOT NULL,
    "debris" JSONB NOT NULL,

    CONSTRAINT "CombatReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EspionageReport" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "targetPlanetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accuracy" DOUBLE PRECISION NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "EspionageReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DebrisField" (
    "id" TEXT NOT NULL,
    "planetId" TEXT NOT NULL,
    "alloy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "heliox" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "DebrisField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GateFragment" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "planetId" TEXT NOT NULL,
    "fragmentKey" TEXT NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GateFragment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EonGate" (
    "id" TEXT NOT NULL,
    "planetId" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linkedGateId" TEXT,
    "isVisible" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "EonGate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alliance" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alliance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllianceMember" (
    "id" TEXT NOT NULL,
    "allianceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rank" "AllianceRank" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AllianceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authorId" TEXT,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UniverseSetting" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "UniverseSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "ipAddress" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE INDEX "VerificationToken_userId_type_idx" ON "VerificationToken"("userId", "type");

-- CreateIndex
CREATE INDEX "Planet_ownerId_idx" ON "Planet"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Planet_galaxy_system_slot_key" ON "Planet"("galaxy", "system", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "Building_planetId_key_key" ON "Building"("planetId", "key");

-- CreateIndex
CREATE INDEX "BuildQueueItem_planetId_status_idx" ON "BuildQueueItem"("planetId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Research_userId_key_key" ON "Research"("userId", "key");

-- CreateIndex
CREATE INDEX "ResearchQueueItem_planetId_status_idx" ON "ResearchQueueItem"("planetId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Ship_planetId_key_key" ON "Ship"("planetId", "key");

-- CreateIndex
CREATE INDEX "ShipyardQueueItem_planetId_status_idx" ON "ShipyardQueueItem"("planetId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Defence_planetId_key_key" ON "Defence"("planetId", "key");

-- CreateIndex
CREATE INDEX "FleetMission_originId_idx" ON "FleetMission"("originId");

-- CreateIndex
CREATE INDEX "FleetMission_status_idx" ON "FleetMission"("status");

-- CreateIndex
CREATE INDEX "CombatReport_attackerId_idx" ON "CombatReport"("attackerId");

-- CreateIndex
CREATE INDEX "CombatReport_defenderId_idx" ON "CombatReport"("defenderId");

-- CreateIndex
CREATE INDEX "EspionageReport_ownerId_idx" ON "EspionageReport"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "DebrisField_planetId_key" ON "DebrisField"("planetId");

-- CreateIndex
CREATE INDEX "GateFragment_ownerId_idx" ON "GateFragment"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "EonGate_planetId_key" ON "EonGate"("planetId");

-- CreateIndex
CREATE UNIQUE INDEX "EonGate_linkedGateId_key" ON "EonGate"("linkedGateId");

-- CreateIndex
CREATE UNIQUE INDEX "Alliance_name_key" ON "Alliance"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Alliance_tag_key" ON "Alliance"("tag");

-- CreateIndex
CREATE UNIQUE INDEX "AllianceMember_userId_key" ON "AllianceMember"("userId");

-- CreateIndex
CREATE INDEX "Message_recipientId_idx" ON "Message"("recipientId");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UniverseSetting_key_key" ON "UniverseSetting"("key");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "SecurityEvent_userId_idx" ON "SecurityEvent"("userId");

-- CreateIndex
CREATE INDEX "SecurityEvent_type_idx" ON "SecurityEvent"("type");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationToken" ADD CONSTRAINT "VerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Planet" ADD CONSTRAINT "Planet_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Building" ADD CONSTRAINT "Building_planetId_fkey" FOREIGN KEY ("planetId") REFERENCES "Planet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildQueueItem" ADD CONSTRAINT "BuildQueueItem_planetId_fkey" FOREIGN KEY ("planetId") REFERENCES "Planet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchQueueItem" ADD CONSTRAINT "ResearchQueueItem_planetId_fkey" FOREIGN KEY ("planetId") REFERENCES "Planet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ship" ADD CONSTRAINT "Ship_planetId_fkey" FOREIGN KEY ("planetId") REFERENCES "Planet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipyardQueueItem" ADD CONSTRAINT "ShipyardQueueItem_planetId_fkey" FOREIGN KEY ("planetId") REFERENCES "Planet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Defence" ADD CONSTRAINT "Defence_planetId_fkey" FOREIGN KEY ("planetId") REFERENCES "Planet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetMission" ADD CONSTRAINT "FleetMission_originId_fkey" FOREIGN KEY ("originId") REFERENCES "Planet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FleetMission" ADD CONSTRAINT "FleetMission_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Planet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebrisField" ADD CONSTRAINT "DebrisField_planetId_fkey" FOREIGN KEY ("planetId") REFERENCES "Planet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GateFragment" ADD CONSTRAINT "GateFragment_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GateFragment" ADD CONSTRAINT "GateFragment_planetId_fkey" FOREIGN KEY ("planetId") REFERENCES "Planet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EonGate" ADD CONSTRAINT "EonGate_planetId_fkey" FOREIGN KEY ("planetId") REFERENCES "Planet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllianceMember" ADD CONSTRAINT "AllianceMember_allianceId_fkey" FOREIGN KEY ("allianceId") REFERENCES "Alliance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllianceMember" ADD CONSTRAINT "AllianceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
