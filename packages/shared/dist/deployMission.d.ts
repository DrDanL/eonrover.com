import { ShipKey } from './types';
export type DeployCoordinates = {
    galaxy: number;
    system: number;
    slot: number;
};
export type DeployPlan = {
    ships: Record<ShipKey, number>;
    speedPercent: number;
    durationSeconds: number;
    fuelHeliox: number;
};
export declare function canonicalDeployShips(input: unknown): Record<ShipKey, number>;
export declare function planDeploy(input: {
    ships: unknown;
    speedPercent: unknown;
    origin: DeployCoordinates;
    destination: DeployCoordinates;
    fleetSpeed: unknown;
    cargo?: unknown;
}): DeployPlan;
