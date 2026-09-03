import { ResourceAmounts } from '@/lib/web-types';
import { formatDecimal, formatNumber } from '@/lib/formatters';

interface ResourceBarProps {
  resources: ResourceAmounts;
  storage?: Partial<ResourceAmounts>;
  production?: Partial<ResourceAmounts>;
}

const RESOURCE_META = [
  { key: 'alloy', label: 'Alloy', className: 'resource-alloy' },
  { key: 'heliox', label: 'Heliox', className: 'resource-heliox' },
  { key: 'aether', label: 'Aether', className: 'resource-aether' },
] as const;

export default function ResourceBar({ resources, storage, production }: ResourceBarProps) {
  return (
    <div className="grid grid-cards resource-bar-grid">
      {RESOURCE_META.map((resource) => {
        const value = resources[resource.key];
        const capacity = storage?.[resource.key];
        const perHour = production?.[resource.key];
        const ratio = capacity ? Math.max(0, Math.min(100, (value / capacity) * 100)) : 0;

        return (
          <div className="panel stack" key={resource.key} style={{ gap: '0.65rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'baseline' }}>
              <strong className={resource.className}>{resource.label}</strong>
              <span>{formatNumber(value)}</span>
            </div>
            {capacity ? (
              <>
                <div className="progress-bar">
                  <span style={{ width: `${ratio}%` }} />
                </div>
                <small style={{ color: 'var(--color-text-muted)' }}>Storage: {formatNumber(capacity)}</small>
              </>
            ) : null}
            {perHour !== undefined ? (
              <small style={{ color: 'var(--color-text-muted)' }}>Hourly output: {formatDecimal(perHour)}</small>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
