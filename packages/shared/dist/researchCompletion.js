"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.completeResearch = completeResearch;
exports.completeDueResearchForUser = completeDueResearchForUser;
const researchCatalogue_1 = require("./researchCatalogue");
function isSerializationFailure(error) {
    return error?.code === 'P2034' || (error?.code === 'P2010' && error?.meta?.code === '40001');
}
async function completeResearch(database, queueItemId, now = new Date()) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            return await database.$transaction(async (transaction) => {
                const initial = await transaction.researchQueueItem.findUnique({ where: { id: queueItemId } });
                if (!initial)
                    return 'missing';
                // The fixed order makes completion compatible with the Stage 6B cancel path.
                await transaction.$queryRawUnsafe('SELECT "id" FROM "User" WHERE "id" = $1 FOR UPDATE', initial.userId);
                await transaction.$queryRawUnsafe('SELECT "id" FROM "Planet" WHERE "id" = $1 FOR UPDATE', initial.planetId);
                await transaction.$queryRawUnsafe('SELECT "id" FROM "ResearchQueueItem" WHERE "id" = $1 FOR UPDATE', queueItemId);
                const item = await transaction.researchQueueItem.findUnique({ where: { id: queueItemId } });
                if (!item)
                    return 'missing';
                if (item.status === 'CANCELLED')
                    return 'cancelled';
                if (item.status === 'COMPLETE')
                    return 'complete';
                if (now < item.completesAt)
                    return 'too-early';
                const current = await transaction.research.findUnique({
                    where: { userId_key: { userId: item.userId, key: item.researchKey } },
                });
                if ((current?.level ?? 0) < item.targetLevel) {
                    await transaction.research.upsert({
                        where: { userId_key: { userId: item.userId, key: item.researchKey } },
                        update: { level: item.targetLevel },
                        create: { userId: item.userId, key: item.researchKey, level: item.targetLevel },
                    });
                }
                // This state transition and notification share the transaction, so all
                // duplicate jobs/read fallbacks observe one terminal completion.
                const claimed = await transaction.researchQueueItem.updateMany({
                    where: { id: item.id, status: 'PENDING' },
                    data: { status: 'COMPLETE' },
                });
                if (claimed.count !== 1)
                    return 'complete';
                const name = researchCatalogue_1.RESEARCH_BY_ID[item.researchKey]?.name ?? 'Research';
                await transaction.notification.create({
                    data: {
                        userId: item.userId,
                        type: 'RESEARCH_COMPLETE',
                        message: `${name} reached level ${item.targetLevel}.`,
                    },
                });
                return 'completed';
            }, { isolationLevel: 'Serializable' });
        }
        catch (error) {
            if (!isSerializationFailure(error) || attempt === 2)
                throw error;
        }
    }
    throw new Error('Research completion exhausted retries');
}
async function completeDueResearchForUser(database, userId, now = new Date()) {
    const due = await database.researchQueueItem.findMany({
        where: { userId, status: 'PENDING', completesAt: { lte: now } },
        orderBy: { id: 'asc' },
        take: 100,
        select: { id: true },
    });
    for (const item of due)
        await completeResearch(database, item.id, now);
}
