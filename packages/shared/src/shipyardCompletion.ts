/** The Prisma surface used by Shipyard completion.  PostgreSQL is the source
 * of truth; BullMQ is deliberately only a wake-up mechanism. */
export interface ShipyardCompletionDatabase {
  $transaction<T>(callback: (transaction: any) => Promise<T>, options?: unknown): Promise<T>;
  shipyardQueueItem: any;
}

export type ShipyardCompletionResult = 'missing' | 'cancelled' | 'complete' | 'too-early' | 'completed';

/** Legacy `itemType: defence` rows were permissive.  They are deliberately
 * never inventory-authoritative; only a validated Flak batch stamped by the
 * canonical start transaction may complete into Defence. */
function isCanonicalFlakBatch(item: { itemType: unknown; itemKey: unknown; canonicalDefenceKey?: unknown }): boolean {
  return item.itemType === 'defence' && item.itemKey === 'flakTurret' && item.canonicalDefenceKey === 'flakTurret';
}

function isCanonicalShipBatch(item: { itemType: unknown; itemKey: unknown }): boolean {
  return item.itemType === 'ship' && typeof item.itemKey === 'string' && ['scout', 'transporter', 'colonyShip', 'corvette', 'frigate', 'recycler', 'probe'].includes(item.itemKey);
}

function isSerializationFailure(error: any): boolean {
  return error?.code === 'P2034' || (error?.code === 'P2010' && error?.meta?.code === '40001');
}

/**
 * Completes one persisted Shipyard batch exactly once.  Callers provide only
 * the queue id: ownership, item type, quantity, due time, and notification
 * recipient are all reloaded under the established account -> planet -> queue
 * lock order.
 */
export async function completeShipyardBatch(
  database: ShipyardCompletionDatabase,
  queueItemId: string,
  now = new Date(),
): Promise<ShipyardCompletionResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await database.$transaction(async (transaction) => {
        const initial = await transaction.shipyardQueueItem.findUnique({
          where: { id: queueItemId }, select: { id: true, planetId: true },
        });
        if (!initial) return 'missing';

        const initialPlanet = await transaction.planet.findUnique({
          where: { id: initial.planetId }, select: { ownerId: true },
        });
        if (!initialPlanet) return 'missing';

        await transaction.$queryRawUnsafe('SELECT "id" FROM "User" WHERE "id" = $1 FOR UPDATE', initialPlanet.ownerId);
        await transaction.$queryRawUnsafe('SELECT "id" FROM "Planet" WHERE "id" = $1 FOR UPDATE', initial.planetId);
        await transaction.$queryRawUnsafe('SELECT "id" FROM "ShipyardQueueItem" WHERE "id" = $1 FOR UPDATE', queueItemId);

        const item = await transaction.shipyardQueueItem.findUnique({ where: { id: queueItemId } });
        const planet = await transaction.planet.findUnique({ where: { id: initial.planetId } });
        if (!item || !planet || item.planetId !== planet.id) return 'missing';
        if (item.status === 'CANCELLED') return 'cancelled';
        if (item.status === 'COMPLETE') return 'complete';
        if (now < item.completesAt) return 'too-early';

        // Do not turn arbitrary historical queue data into inventory.  Legacy
        // malformed rows are terminally contained without notification.
        if (!isCanonicalShipBatch(item) && !isCanonicalFlakBatch(item)) return 'missing';

        // Claim first.  The inventory and notification are in the same
        // transaction, so duplicate workers and API fallbacks are harmless.
        const claimed = await transaction.shipyardQueueItem.updateMany({
          where: { id: item.id, status: 'PENDING' }, data: { status: 'COMPLETE', remaining: 0 },
        });
        if (claimed.count !== 1) return 'complete';

        const inventory = isCanonicalFlakBatch(item) ? transaction.defence : transaction.ship;
        await inventory.upsert({
          where: { planetId_key: { planetId: planet.id, key: item.itemKey } },
          update: { count: { increment: item.quantity } },
          create: { planetId: planet.id, key: item.itemKey, count: item.quantity },
        });
        await transaction.notification.create({
          data: {
            userId: planet.ownerId,
            type: 'SHIPYARD_COMPLETE',
            message: `${item.quantity}x ${item.itemKey} finished construction on ${planet.name}.`,
          },
        });
        return 'completed';
      }, { isolationLevel: 'Serializable' });
    } catch (error: any) {
      if (!isSerializationFailure(error) || attempt === 2) throw error;
    }
  }
  throw new Error('Shipyard completion exhausted retries');
}

export async function completeDueShipyardForPlanet(
  database: ShipyardCompletionDatabase,
  planetId: string,
  now = new Date(),
): Promise<void> {
  const due = await database.shipyardQueueItem.findMany({
    where: { planetId, status: 'PENDING', completesAt: { lte: now } },
    orderBy: { id: 'asc' }, take: 100, select: { id: true },
  });
  for (const item of due) await completeShipyardBatch(database, item.id, now);
}
