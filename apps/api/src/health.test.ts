import request from 'supertest';
import { createApp } from './app';
import { ReadinessChecks } from './health';

function passingChecks(): ReadinessChecks {
  return {
    database: jest.fn(async () => undefined),
    redis: jest.fn(async () => undefined),
  };
}

describe('API operational probes', () => {
  it('returns liveness without calling dependencies', async () => {
    const checks = passingChecks();
    const response = await request(createApp({ readinessChecks: checks }))
      .get('/healthz')
      .expect(200)
      .expect('Content-Type', /json/);

    expect(response.body).toEqual({ status: 'ok' });
    expect(checks.database).not.toHaveBeenCalled();
    expect(checks.redis).not.toHaveBeenCalled();
  });

  it('returns ready when PostgreSQL and Redis checks pass', async () => {
    const checks = passingChecks();
    const response = await request(createApp({ readinessChecks: checks }))
      .get('/readyz')
      .expect(200)
      .expect('Content-Type', /json/);

    expect(response.body).toEqual({
      status: 'ready',
      checks: { database: 'ok', redis: 'ok' },
    });
    expect(checks.database).toHaveBeenCalledTimes(1);
    expect(checks.redis).toHaveBeenCalledTimes(1);
  });

  it('returns not ready when PostgreSQL fails and still checks Redis', async () => {
    const checks: ReadinessChecks = {
      database: jest.fn(async () => {
        throw new Error('postgresql://operator:secret@private-db.example:5432/eonrover');
      }),
      redis: jest.fn(async () => undefined),
    };
    const response = await request(createApp({ readinessChecks: checks })).get('/readyz').expect(503);

    expect(response.body).toEqual({
      status: 'not_ready',
      checks: { database: 'unavailable', redis: 'ok' },
    });
    expect(checks.database).toHaveBeenCalledTimes(1);
    expect(checks.redis).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(response.body)).not.toContain('private-db');
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });

  it('returns not ready when Redis fails', async () => {
    const checks: ReadinessChecks = {
      database: jest.fn(async () => undefined),
      redis: jest.fn(async () => {
        throw new Error('redis://operator:secret@private-cache.example:6379/12');
      }),
    };
    const response = await request(createApp({ readinessChecks: checks })).get('/readyz').expect(503);

    expect(response.body).toEqual({
      status: 'not_ready',
      checks: { database: 'ok', redis: 'unavailable' },
    });
    expect(JSON.stringify(response.body)).not.toContain('private-cache');
    expect(JSON.stringify(response.body)).not.toContain('6379');
  });

  it('bounds a dependency check with a timeout', async () => {
    const checks: ReadinessChecks = {
      database: jest.fn(() => new Promise(() => undefined)),
      redis: jest.fn(async () => undefined),
    };
    const response = await request(createApp({ readinessChecks: checks, readinessTimeoutMs: 10 }))
      .get('/readyz')
      .expect(503);

    expect(response.body).toEqual({
      status: 'not_ready',
      checks: { database: 'unavailable', redis: 'ok' },
    });
    expect(checks.redis).toHaveBeenCalledTimes(1);
  });

  it('leaves the normal API error contract unchanged', async () => {
    const response = await request(createApp({ readinessChecks: passingChecks() }))
      .get('/api/unknown')
      .expect(404)
      .expect('Content-Type', /json/);

    expect(response.body).toEqual({ error: 'Not found', code: 'NOT_FOUND' });
  });
});
