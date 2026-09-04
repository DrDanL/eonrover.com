import { Prisma } from '@prisma/client';
import express from 'express';
import rateLimit from 'express-rate-limit';
import request from 'supertest';
import { z } from 'zod';
import {
  apiErrorHandler,
  apiNotFoundHandler,
  AppError,
  asyncHandler,
  ERROR_CODES,
  normalizeError,
  rateLimitErrorHandler,
} from './error';

const SECRET_MESSAGE = 'database password is asteroid-secret';

function createBoundaryApp() {
  const app = express();
  app.use(express.json({ limit: '1kb' }));
  app.get('/expected', asyncHandler(async () => {
    throw new AppError(409, ERROR_CODES.CONFLICT, 'Expected conflict');
  }));
  app.post('/validate', asyncHandler(async (req, res) => {
    const body = z.object({ callsign: z.string().min(3) }).parse(req.body);
    res.json(body);
  }));
  app.get('/unexpected', asyncHandler(async () => {
    throw new Error(SECRET_MESSAGE);
  }));
  app.get(
    '/limited',
    rateLimit({ windowMs: 60_000, max: 1, legacyHeaders: false, handler: rateLimitErrorHandler }),
    (_req, res) => res.json({ ok: true }),
  );
  app.use(apiNotFoundHandler);
  app.use(apiErrorHandler);
  return app;
}

describe('API error boundary', () => {
  it('returns an expected application error with its status and stable code', async () => {
    const response = await request(createBoundaryApp()).get('/expected').expect(409).expect('Content-Type', /json/);

    expect(response.body).toEqual({ error: 'Expected conflict', code: 'CONFLICT' });
    expect(typeof response.body.error).toBe('string');
  });

  it('normalizes a thrown Zod validation failure with field details', async () => {
    const response = await request(createBoundaryApp()).post('/validate').send({ callsign: 'x' }).expect(400);

    expect(response.body).toEqual({
      error: 'The request contains invalid values.',
      code: 'VALIDATION_ERROR',
      details: { callsign: [expect.any(String)] },
    });
  });

  it('returns safe JSON for malformed request bodies', async () => {
    const response = await request(createBoundaryApp())
      .post('/validate')
      .set('Content-Type', 'application/json')
      .send('{"callsign":')
      .expect(400)
      .expect('Content-Type', /json/);

    expect(response.body).toEqual({ error: 'Malformed JSON request body.', code: 'BAD_REQUEST' });
  });

  it('returns the standard not-found response for an unknown route', async () => {
    const response = await request(createBoundaryApp()).get('/missing').expect(404).expect('Content-Type', /json/);

    expect(response.body).toEqual({ error: 'Not found', code: 'NOT_FOUND' });
  });

  it('returns a deterministic rate-limit response', async () => {
    const app = createBoundaryApp();
    await request(app).get('/limited').expect(200);
    const response = await request(app).get('/limited').expect(429).expect('Content-Type', /json/);

    expect(response.body).toEqual({
      error: 'Too many requests. Please try again later.',
      code: 'RATE_LIMITED',
    });
  });

  it('does not expose an unexpected exception message or stack trace', async () => {
    const response = await request(createBoundaryApp()).get('/unexpected').expect(500).expect('Content-Type', /json/);
    const serialized = JSON.stringify(response.body);

    expect(response.body).toEqual({ error: 'An unexpected error occurred.', code: 'INTERNAL_ERROR' });
    expect(serialized).not.toContain(SECRET_MESSAGE);
    expect(serialized).not.toContain('error.unit.test.ts');
    expect(serialized).not.toContain(' at ');
  });
});

describe('normalizeError', () => {
  it('translates a recognised Prisma unique conflict without exposing metadata', () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError('secret query details', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['passwordHash'] },
    });

    const normalized = normalizeError(prismaError);

    expect(normalized).toMatchObject({ status: 409, code: 'CONFLICT' });
    expect(normalized.message).not.toContain('secret query details');
    expect(normalized.details).toBeUndefined();
  });

  it('translates a recognised Prisma missing-record error', () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError('secret record details', {
      code: 'P2025',
      clientVersion: 'test',
    });

    expect(normalizeError(prismaError)).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      message: 'The requested resource was not found.',
    });
  });

  it('keeps unknown Prisma failures generic', () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError('connection has secret-host.example', {
      code: 'P9999',
      clientVersion: 'test',
    });

    expect(normalizeError(prismaError)).toMatchObject({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    });
  });
});
