export interface HomeworldCoordinate {
  galaxy: number;
  system: number;
  slot: number;
}

export function generateHomeworldCoordinate(): HomeworldCoordinate {
  return {
    galaxy: 1 + Math.floor(Math.random() * 6),
    system: 1 + Math.floor(Math.random() * 400),
    slot: 1 + Math.floor(Math.random() * 12),
  };
}
