import type { BuildingKey } from '@eonrover/shared';

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
    demand: number;
    available: number;
    utilisationPercentage: number;
    productionEfficiency: number;
    status: 'healthy' | 'approaching' | 'at-capacity' | 'deficit';
  };
  storage: ResourceAmounts;
}

export interface BuildingCatalogItem {
  id: string;
  key: string;
  name: string;
  category: BuildingCategory;
  description: string;
  currentLevel: number;
  level: number;
  nextLevel: number;
  upgradeCost: ResourceAmounts;
  nextCost: ResourceAmounts;
  constructionDurationSeconds: number;
  effect: {
    kind: string;
    label: string;
    unit: string;
    current: number;
    next: number;
  };
  energyEffect: {
    current: BuildingEnergyEffect;
    next: BuildingEnergyEffect;
  };
  energyProjection: {
    supply: number;
    currentDemand: number;
    projectedSupply: number;
    projectedDemand: number;
    projectedAvailable: number;
    additionalRequired: number;
    shortfall: number;
  };
  fieldRequirement: number;
  projectedOccupied: number;
  projectedAvailable: number;
  hasSufficientFields: boolean;
  requirements: Array<{
    buildingId: string;
    buildingName: string;
    currentLevel: number;
    requiredLevel: number;
    met: boolean;
  }>;
  unmetRequirements: Array<{
    buildingId: string;
    buildingName: string;
    currentLevel: number;
    requiredLevel: number;
    met: boolean;
  }>;
  meetsPrerequisites: boolean;
  missingResources: ResourceAmounts;
  affordable: boolean;
  hasSufficientEnergy: boolean;
  energyRequirementMet: boolean;
  canConstruct: boolean;
  unavailableReasonCode: string | null;
  unavailableReason: string | null;
}

export type BuildingCategory = 'resources' | 'energy' | 'infrastructure';

export interface BuildingCategoryMetadata {
  key: BuildingCategory;
  label: string;
  description: string;
}

export interface BuildingEnergyEffect {
  kind: 'supply' | 'demand' | 'none';
  amount: number;
}

export interface PlanetEnergySummary {
  supply: number;
  demand: number;
  available: number;
  utilisationPercentage: number;
  productionEfficiency: number;
  status: 'healthy' | 'approaching' | 'at-capacity' | 'deficit';
}

export interface PlanetFieldSummary {
  capacity: number;
  completedUsed: number;
  reserved: number;
  occupied: number;
  available: number;
  isAtCapacity: boolean;
  isOverCapacity: boolean;
  overCapacityBy: number;
}

export interface OwnedPlanetOption {
  id: string;
  name: string;
  isHomeworld: boolean;
  galaxy: number;
  system: number;
  slot: number;
}

export interface CommandPlanetSummary {
  identity: {
    id: string;
    name: string;
    isHomeworld: boolean;
    coordinates: {
      galaxy: number;
      system: number;
      slot: number;
    };
    planetType: string;
    temperature: number;
    solarIndex: number;
  };
  resources: ResourceAmounts;
  storage: ResourceAmounts;
  productionPerHour: ResourceAmounts;
  energy: PlanetEnergySummary;
  fields: PlanetFieldSummary;
  activeConstruction: null | {
    id: string;
    buildingKey: BuildingKey;
    buildingName: string;
    targetLevel: number;
    startedAt: string;
    completesAt: string;
  };
  buildings: Array<{
    key: BuildingKey;
    name: string;
    level: number;
  }>;
  energyBlockedBuildingKeys: BuildingKey[];
}

export interface CommandSummaryResponse {
  serverTimestamp: string;
  selectedPlanetId: string | null;
  selectedPlanet: CommandPlanetSummary | null;
  activeResearch: ActiveResearchSummary | null;
  ownedPlanets: OwnedPlanetOption[];
}

export interface ActiveResearchSummary {
  queueItemId: string;
  id: string;
  name: string;
  targetLevel: number;
  startedAt: string;
  completesAt: string;
  status: string;
  originatingPlanet: { id: string; name: string; galaxy: number; system: number; slot: number };
}

export interface PresentedBuildQueueItem {
  id: string;
  buildingKey: string;
  buildingName: string;
  targetLevel: number;
  costAlloy: number;
  costHeliox: number;
  costAether: number;
  startedAt: string;
  completesAt: string;
  status: string;
  cancellation: {
    refundPercentage: number;
    refund: ResourceAmounts;
  };
}

export interface ResearchCatalogItem {
  id: string;
  name: string;
  description: string;
  category: string;
  displayOrder: number;
  currentLevel: number;
  nextLevel: number;
  cost: ResourceAmounts;
  durationSeconds: number;
  requirements: Array<{ type: 'building' | 'research'; id: string; name: string; requiredLevel: number; currentLevel: number; met: boolean }>;
  unmetRequirements: Array<{ type: 'building' | 'research'; id: string; name: string; requiredLevel: number; currentLevel: number; met: boolean }>;
  meetsRequirements: boolean;
  affordable: boolean;
  effect: { description: string; status: 'ACTIVE' | 'PARTIAL' | 'PLANNED' };
  scheduling: { available: boolean; reason: string };
}

export interface ResearchCatalogueResponse {
  generatedAt: string;
  selectedPlanet: { id: string; name: string; researchLabLevel: number; resources: ResourceAmounts };
  accountResearchLevels: Record<string, number>;
  categories: Array<{ id: string; name: string; displayOrder: number }>;
  catalog: ResearchCatalogItem[];
  activeResearch: (ActiveResearchSummary & { cost: ResourceAmounts; cancellation: { refundPercentage: number; refund: ResourceAmounts } }) | null;
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

export interface ShipyardReadOnlyResponse {
  selectedPlanet: { id: string; name: string; shipyardLevel: number; resources: ResourceAmounts };
  categories: Array<{ id: 'civilian' | 'combat' | 'specialist'; name: string; displayOrder: number }>;
  catalog: Array<{ id: string; key: string; name: string; description: string; category: 'civilian' | 'combat' | 'specialist'; cost: ResourceAmounts; durationSeconds: number; owned: number; statistics: { cargo: number; speed: number; fuelPerDistance: number; attack: number; shield: number; armour: number }; requirements: Array<{ id: string; requiredLevel: number; currentLevel: number; met: boolean; type: 'building' | 'research' }>; meetsRequirements: boolean; missions: readonly string[]; effect: { description: string; status: 'ACTIVE' | 'PARTIAL' | 'PLANNED' } }>;
  activeQueue: { id: string; shipKey: string; shipName: string; quantity: number; cost: ResourceAmounts; durationSeconds: number; startedAt: string; completesAt: string; status: string; cancellation: { refundPercentage: number; refund: ResourceAmounts } } | null;
  legacyQueue: Array<{ id: string; itemKey: string; itemType: string; quantity: number; remaining: number; startedAt: string; completesAt: string; status: string }>;
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

export interface FleetDeploymentsResponse {
  selectedOrigin: {
    id: string;
    name: string;
    coordinates: { galaxy: number; system: number; slot: number };
    heliox: number;
    ships: Array<{ key: string; count: number }>;
  };
  eligibleDestinations: Array<{
    id: string;
    name: string;
    coordinates: { galaxy: number; system: number; slot: number };
  }>;
  supportedSpeedOptions: number[];
  activeDeployment: {
    id: string;
    destination: {
      id: string;
      name: string;
      coordinates: { galaxy: number; system: number; slot: number };
    };
    ships: Record<string, number>;
    fuelHeliox: number;
    durationSeconds: number;
    departedAt: string;
    arrivesAt: string;
    status: string;
  } | null;
}

export interface FleetColonizationsResponse {
  selectedOrigin: {
    id: string;
    name: string;
    coordinates: { galaxy: number; system: number; slot: number };
    heliox: number;
    availableColonyShips: number;
  };
  availableTargetSlots: number[];
  activeColonization: {
    origin: {
      id: string;
      name: string;
      coordinates: { galaxy: number; system: number; slot: number };
    };
    target: { coordinates: { galaxy: number; system: number; slot: number } };
    status: string;
    departedAt: string;
    arrivesAt: string;
    durationSeconds: number;
  } | null;
}

export interface FleetTransportsResponse {
  selectedOrigin: {
    id: string;
    name: string;
    coordinates: { galaxy: number; system: number; slot: number };
    resources: ResourceAmounts;
    transporterCount: number;
  };
  transporterCapacityPerShip: number;
  eligibleDestinations: Array<{
    id: string;
    name: string;
    coordinates: { galaxy: number; system: number; slot: number };
  }>;
  activeTransport: {
    id: string;
    origin: {
      id: string;
      name: string;
      coordinates: { galaxy: number; system: number; slot: number };
    };
    destination: {
      id: string;
      name: string;
      coordinates: { galaxy: number; system: number; slot: number };
    };
    transporterQuantity: number;
    remainingCargo: ResourceAmounts;
    phase: 'OUTBOUND' | 'AWAITING_DESTINATION_CAPACITY' | 'RETURNING';
    departedAt: string;
    arrivesAt: string;
    returnsAt: string | null;
    capacityWaitMessage: string | null;
  } | null;
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
  role: 'PLAYER' | 'MODERATOR' | 'ADMIN';
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'BANNED';
  emailVerified: boolean;
  createdAt: string;
  planetCount: number;
}

export interface AdminPlayerState {
  player: AdminUser & {
    protectedUntil: string | null;
    activeSessionCount: number;
    unreadNotificationCount: number;
  };
  planets: Array<{
    id: string;
    name: string;
    isHomeworld: boolean;
    galaxy: number;
    system: number;
    position: number;
    planetType: string;
    environment: {
      temperature: number;
      solarIndex: number;
    };
    resources: ResourceAmounts;
    lastProductionAt: string;
    production: ResourceAmounts;
    energy: {
      supply: number;
      demand: number;
      efficiency: number;
    };
    fields: PlanetFieldSummary;
    storage: ResourceAmounts;
    buildings: Array<{ key: string; level: number }>;
    activeConstruction: {
      buildingKey: string;
      targetLevel: number;
      status: 'PENDING';
      startedAt: string;
      completesAt: string;
    } | null;
  }>;
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

export interface GateFragment {
  id: string;
  ownerId: string;
  planetId: string;
  fragmentKey: string;
  discoveredAt: string;
}

export interface EonGateSummary {
  id: string;
  planetId: string;
  activatedAt: string;
  linkedGateId?: string | null;
  isVisible: boolean;
}
