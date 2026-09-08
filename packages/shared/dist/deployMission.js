"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canonicalDeployShips = canonicalDeployShips;
exports.planDeploy = planDeploy;
const constants_1 = require("./constants");
const formulas_1 = require("./formulas");
function finitePositiveInteger(value) { return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0; }
function validCoordinates(value) { return finitePositiveInteger(value.galaxy) && finitePositiveInteger(value.system) && finitePositiveInteger(value.slot); }
function canonicalDeployShips(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new Error('Deploy ships must be a non-empty object.');
    const entries = Object.entries(input);
    if (!entries.length)
        throw new Error('Deploy ships must be non-empty.');
    const result = {};
    for (const key of Object.keys(constants_1.SHIPS).sort()) {
        const found = entries.find(([candidate]) => candidate === key);
        if (found && finitePositiveInteger(found[1]))
            result[key] = found[1];
    }
    if (Object.keys(result).length !== entries.length)
        throw new Error('Deploy ships contain an unknown or invalid quantity.');
    return result;
}
function planDeploy(input) {
    if (input.cargo !== undefined)
        throw new Error('Deploy missions do not permit cargo.');
    if (!finitePositiveInteger(input.speedPercent) || input.speedPercent < 10 || input.speedPercent > 100)
        throw new Error('Deploy speed must be an integer from 10 through 100.');
    if (typeof input.fleetSpeed !== 'number' || !Number.isFinite(input.fleetSpeed) || input.fleetSpeed <= 0 || !validCoordinates(input.origin) || !validCoordinates(input.destination))
        throw new Error('Deploy travel inputs are invalid.');
    const ships = canonicalDeployShips(input.ships);
    const distance = (0, formulas_1.distanceBetween)(input.origin, input.destination);
    const slowest = Math.min(...Object.keys(ships).map((key) => constants_1.SHIPS[key].speed));
    const durationSeconds = (0, formulas_1.flightDurationSeconds)(distance, slowest, input.speedPercent, input.fleetSpeed);
    const fuelHeliox = (0, formulas_1.fuelConsumption)(ships, distance, durationSeconds);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(fuelHeliox) || fuelHeliox < 0)
        throw new Error('Deploy calculation is invalid.');
    return { ships, speedPercent: input.speedPercent, durationSeconds, fuelHeliox };
}
