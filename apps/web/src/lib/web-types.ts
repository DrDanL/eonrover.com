export interface ResourceAmounts {
  alloy: number;
  heliox: number;
  aether: number;
}

export interface CurrentUserSummary {
  id: string;
  username: string;
  email: string;
  role: 'PLAYER' | 'MODERATOR' | 'ADMIN';
  status?: string;
}

export interface PlanetSummary extends ResourceAmounts {
  id: string;
  name: string;
  isHomeworld: boolean;
  galaxy: number;
  system: number;
  slot: number;
  planetType: string;
  temperature: number;
  solarIndex: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface BuildingLevel {
  id: string;
  planetId: string;
  key: string;
  level: number;
}

export interface CountedUnit {
  id: string;
  planetId: string;
  key: string;
  count: number;
}

export interface QueueItemBase {
  id: string;
  planetId: string;
  startedAt: string;
  completesAt: string;
  status: string;
  jobId?: string | null;
}

export interface BuildQueueItem extends QueueItemBase {
  buildingKey: string;
  targetLevel: number;
}

export interface ResearchQueueItem extends QueueItemBase {
  researchKey: string;
  targetLevel: number;
}

export interface ShipyardQueueItem extends QueueItemBase {
  itemKey: string;
  itemType: string;
  quantity: number;
  remaining: number;
}

export interface PlanetFullState {
  planet: PlanetSummary;
  buildings: BuildingLevel[];
  ships: CountedUnit[];
  defences: CountedUnit[];
  buildQueue: BuildQueueItem[];
  researchQueue: ResearchQueueItem[];
  shipyardQueue: ShipyardQueueItem[];
  energy: {
    supply: number;
    consumption: number;
    efficiency: number;
  };
  storage: ResourceAmounts;
}

export interface BuildingCatalogItem {
  key: string;
  name: string;
  description: string;
  baseEnergy: number;
  level: number;
  nextCost: ResourceAmounts;
  requires?: Record<string, number>;
}

export interface ResearchCatalogItem {
  key: string;
  name: string;
  description: string;
  level: number;
  nextCost: ResourceAmounts;
  requires?: Record<string, number>;
}

export interface ShipyardCatalogItem {
  key: string;
  name: string;
  description?: string;
  cost: ResourceAmounts;
  buildTimeSeconds: number;
  owned: number;
  attack?: number;
  shield?: number;
  armour?: number;
  cargo?: number;
  speed?: number;
  requires?: Record<string, number>;
}

export interface FleetMission {
  id: string;
  originId: string;
  targetId?: string | null;
  targetGalaxy: number;
  targetSystem: number;
  targetSlot: number;
  missionType: string;
  ships: Record<string, number>;
  cargo: ResourceAmounts;
  speedPercent: number;
  departedAt: string;
  arrivesAt: string;
  returnsAt?: string | null;
  status: string;
  resultSummary?: unknown;
}

export interface GalaxySlot {
  slot: number;
  empty: boolean;
  planetId?: string;
  name?: string;
  planetType?: string;
  owner?: string;
  protected?: boolean;
}

export interface GameMessage {
  id: string;
  senderId: string;
  recipientId: string;
  subject: string;
  body: string;
  readAt?: string | null;
  createdAt: string;
  sender?: { username: string };
  recipient?: { username: string };
}

export interface AllianceMember {
  id: string;
  userId: string;
  rank: string;
  joinedAt: string;
  user: { username: string };
}

export interface Alliance {
  id: string;
  name: string;
  tag: string;
  description?: string | null;
  createdAt: string;
  members: AllianceMember[];
}

export interface AllianceMembership {
  id: string;
  userId: string;
  rank: string;
  joinedAt: string;
  alliance: Alliance;
}

export interface LeaderboardEntry {
  username: string;
  alliance: string | null;
  planetCount: number;
  score: number;
}

export interface GameNotification {
  id: string;
  type: string;
  message: string;
  readAt?: string | null;
  createdAt: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  authorId?: string | null;
}

export interface UniverseStats {
  playerCount: number;
  planetCount: number;
  allianceCount: number;
}

export interface UniverseConfig {
  universeSpeed: number;
  economySpeed: number;
  fleetSpeed: number;
  researchSpeed: number;
  newPlayerProtectionHours: number;
  maxPlanetsPerPlayer: number;
}

export interface AdminDashboardData {
  userCount: number;
  activeUsers: number;
  planetCount: number;
  fleetsInFlight: number;
  alliances: number;
  queues: Array<{
    name: string;
    waiting: number;
    delayed: number;
    active: number;
    failed: number;
  }>;
}

export interface AdminUser {
  id: string;
  email: string;
  username: string;
  role: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'BANNED';
  createdAt: string;
  lastLoginAt?: string | null;
  lastActiveAt?: string | null;
}

export interface QueueJob {
  id: string;
  name: string;
  data: unknown;
  failedReason?: string;
}

export interface SecurityEvent {
  id: string;
  userId?: string | null;
  type: string;
  ipAddress?: string | null;
  metadata?: unknown;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  actorId: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: unknown;
  createdAt: string;
  actor: { username: string };
}

export interface CombatReport {
  id: string;
  missionId: string;
  attackerId: string;
  defenderId?: string | null;
  planetId: string;
  createdAt: string;
  outcome: string;
  rounds: unknown;
  debris: unknown;
}

export interface EspionageReport {
  id: string;
  missionId: string;
  ownerId: string;
  targetPlanetId: string;
  createdAt: string;
  accuracy: number;
  data: unknown;
}
