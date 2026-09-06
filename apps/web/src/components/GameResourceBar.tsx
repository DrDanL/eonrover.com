'use client';

import { projectVisualResourceAmount } from '@eonrover/shared';
import { formatDecimal, formatNumber } from '@/lib/formatters';
import { CommandPlanetSummary, ResourceAmounts } from '@/lib/web-types';

interface GameResourceBarProps {
  planet: CommandPlanetSummary;
  serverTimestamp: string;
  now: number;
}

const RESOURCES = [
  { key: 'alloy', label: 'Alloy', className: 'resource-alloy' },
  { key: 'heliox', label: 'Heliox', className: 'resource-heliox' },
  { key: 'aether', label: 'Aether', className: 'resource-aether' },
] as const;

function storageState(amount: number, capacity: number): { label: string; warning: boolean } {
  const ratio = capacity > 0 ? amount / capacity : 0;
  if (ratio >= 1) return { label: 'Storage full', warning: true };
  if (ratio >= 0.9) return { label: 'Storage nearly full', warning: true };
  return { label: `${formatNumber(capacity)} capacity`, warning: false };
}

export default function GameResourceBar({ planet, serverTimestamp, now }: GameResourceBarProps) {
  const serverTimestampMs = Date.parse(serverTimestamp);
  const displayTimestampMs = now || serverTimestampMs;

  return (
    <section className="command-resource-bar" aria-label="Current planetary resources and energy">
      {RESOURCES.map(({ key, label, className }) => {
        const amount = projectVisualResourceAmount({
          amount: planet.resources[key],
          hourlyRate: planet.productionPerHour[key],
          capacity: planet.storage[key],
          serverTimestampMs,
          displayTimestampMs,
        });
        const state = storageState(amount, planet.storage[key]);
        return (
          <div className={`command-resource command-resource-${key}`} key={key}>
            <span className={`command-resource-label ${className}`}>{label}</span>
            <strong>{formatDecimal(amount)}</strong>
            <span>+{formatDecimal(planet.productionPerHour[key])}/h</span>
            <small className={state.warning ? 'resource-warning' : undefined}>{state.label}</small>
          </div>
        );
      })}
      <div className={`command-resource command-resource-energy energy-${planet.energy.status}`}>
        <span className="command-resource-label">Energy</span>
        <strong>{formatDecimal(planet.energy.available)} available</strong>
        <span>{formatDecimal(planet.energy.demand)} / {formatDecimal(planet.energy.supply)}</span>
        <small>
          {planet.energy.status === 'deficit'
            ? `${formatDecimal(planet.energy.productionEfficiency * 100)}% production efficiency`
            : `${formatDecimal(planet.energy.utilisationPercentage)}% utilised`}
        </small>
      </div>
    </section>
  );
}
