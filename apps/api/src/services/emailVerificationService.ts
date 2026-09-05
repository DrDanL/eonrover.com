import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError, ERROR_CODES } from '../middleware/error';

export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1_000;
export const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1_000;
const TOKEN_DIGEST_PREFIX = 'sha256:';
const SERIALIZABLE_TRANSACTION_ATTEMPTS = 3;

function invalidVerificationToken(): AppError {
  return new AppError(400, ERROR_CODES.BAD_REQUEST, 'Invalid or expired token');
}

export function generateEmailVerificationToken(): string {
  return randomBytes(32).toString('base64url');
}

export function emailVerificationTokenStorageValue(rawToken: string): string {
  return `${TOKEN_DIGEST_PREFIX}${createHash('sha256').update(rawToken).digest('hex')}`;
}

function verificationTokenLookupValues(rawToken: string): string[] {
  const values = [emailVerificationTokenStorageValue(rawToken)];
  // UUID-based verification tokens created before digest storage remain usable.
  // A stored digest itself is never accepted as a bearer token.
  if (!rawToken.startsWith(TOKEN_DIGEST_PREFIX)) values.push(rawToken);
  return values;
}

function isSerializableTransactionConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}

export interface RotatedVerificationToken {
  email: string;
  rawToken: string;
}

export async function rotateEmailVerificationToken(
  normalizedEmail: string,
  now = new Date(),
): Promise<RotatedVerificationToken | null> {
  for (let attempt = 0; attempt < SERIALIZABLE_TRANSACTION_ATTEMPTS; attempt += 1) {
    const rawToken = generateEmailVerificationToken();

    try {
      return await prisma.$transaction(async (tx) => {
        const user = await tx.user.findFirst({
          where: {
            email: { equals: normalizedEmail, mode: 'insensitive' },
            status: 'PENDING_VERIFICATION',
            emailVerifiedAt: null,
          },
          select: { id: true, email: true },
        });
        if (!user) return null;

        const latestUnusedToken = await tx.verificationToken.findFirst({
          where: { userId: user.id, type: 'EMAIL_VERIFY', usedAt: null },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        });
        if (
          latestUnusedToken &&
          latestUnusedToken.createdAt.getTime() > now.getTime() - VERIFICATION_RESEND_COOLDOWN_MS
        ) {
          return null;
        }

        await tx.verificationToken.deleteMany({
          where: { userId: user.id, type: 'EMAIL_VERIFY', usedAt: null },
        });
        await tx.verificationToken.create({
          data: {
            userId: user.id,
            token: emailVerificationTokenStorageValue(rawToken),
            type: 'EMAIL_VERIFY',
            createdAt: now,
            expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS),
          },
        });

        return { email: user.email, rawToken };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (isSerializableTransactionConflict(error)) {
        if (attempt + 1 < SERIALIZABLE_TRANSACTION_ATTEMPTS) continue;
        return null;
      }
      throw error;
    }
  }

  return null;
}

export async function consumeEmailVerificationToken(rawToken: string, now = new Date()): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const record = await tx.verificationToken.findFirst({
      where: {
        token: { in: verificationTokenLookupValues(rawToken) },
        type: 'EMAIL_VERIFY',
      },
      include: {
        user: { select: { status: true, emailVerifiedAt: true } },
      },
    });
    if (
      !record ||
      record.usedAt ||
      record.expiresAt < now ||
      record.user.status !== 'PENDING_VERIFICATION' ||
      record.user.emailVerifiedAt
    ) {
      throw invalidVerificationToken();
    }

    const tokenUpdate = await tx.verificationToken.updateMany({
      where: {
        id: record.id,
        type: 'EMAIL_VERIFY',
        usedAt: null,
        expiresAt: { gte: now },
      },
      data: { usedAt: now },
    });
    if (tokenUpdate.count !== 1) throw invalidVerificationToken();

    const userUpdate = await tx.user.updateMany({
      where: {
        id: record.userId,
        status: 'PENDING_VERIFICATION',
        emailVerifiedAt: null,
      },
      data: { status: 'ACTIVE', emailVerifiedAt: now },
    });
    if (userUpdate.count !== 1) throw invalidVerificationToken();
  });
}
