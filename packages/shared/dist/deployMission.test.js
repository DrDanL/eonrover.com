"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const deployMission_1 = require("./deployMission");
const origin = { galaxy: 1, system: 1, slot: 1 };
const destination = { galaxy: 1, system: 2, slot: 1 };
(0, node_test_1.default)('canonicalises deploy manifests in stable ship-key order', () => strict_1.default.deepEqual((0, deployMission_1.canonicalDeployShips)({ transporter: 2, scout: 1 }), { scout: 1, transporter: 2 }));
(0, node_test_1.default)('rejects invalid, spoofed or empty manifests', () => { for (const value of [{ unknown: 1 }, { scout: 0 }, { scout: 1.5 }, { scout: Infinity }, [], null])
    strict_1.default.throws(() => (0, deployMission_1.canonicalDeployShips)(value)); });
(0, node_test_1.default)('rejects unsupported speeds and cargo', () => { strict_1.default.throws(() => (0, deployMission_1.planDeploy)({ ships: { scout: 1 }, speedPercent: 9, origin, destination, fleetSpeed: 1 })); strict_1.default.throws(() => (0, deployMission_1.planDeploy)({ ships: { scout: 1 }, speedPercent: 100, origin, destination, fleetSpeed: 1, cargo: {} })); });
(0, node_test_1.default)('calculates finite stable fuel and duration for equivalent manifests', () => { const a = (0, deployMission_1.planDeploy)({ ships: { transporter: 2, scout: 1 }, speedPercent: 100, origin, destination, fleetSpeed: 1 }); const b = (0, deployMission_1.planDeploy)({ ships: { scout: 1, transporter: 2 }, speedPercent: 100, origin, destination, fleetSpeed: 1 }); strict_1.default.deepEqual(a, b); strict_1.default.ok(Number.isFinite(a.durationSeconds) && Number.isFinite(a.fuelHeliox)); });
