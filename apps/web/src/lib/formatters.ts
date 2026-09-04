export interface CoordsLike {
  galaxy: number;
  system: number;
  slot: number;
}

export function formatNumber(value: number | string | null | undefined): string {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (numeric === null || numeric === undefined || Number.isNaN(numeric)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(numeric);
}

export function formatDecimal(value: number | string | null | undefined, digits = 2): string {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (numeric === null || numeric === undefined || Number.isNaN(numeric)) return '—';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(numeric);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatRelativeCountdown(value: string | Date | null | undefined, now = Date.now()): string {
  if (!value) return '—';
  const target = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (Number.isNaN(target)) return '—';
  const remaining = Math.max(0, Math.floor((target - now) / 1000));
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

export function formatCoords(coords: CoordsLike): string {
  return `[${coords.galaxy}:${coords.system}:${coords.slot}]`;
}

export function enumLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
