import { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'http';
import { createHealthHandler, healthResponse, ReadinessChecks } from './health';

function passingChecks(): ReadinessChecks {
  return {
    database: jest.fn(async () => undefined),
    redis: jest.fn(async () => undefined),
  };
}

describe('worker operational probes', () => {
  it('returns liveness without calling dependencies', async () => {
    const checks = passingChecks();

    await expect(healthResponse('GET', '/healthz', checks)).resolves.toEqual({
      statusCode: 200,
      body: { status: 'ok' },
    });
    expect(checks.database).not.toHaveBeenCalled();
    expect(checks.redis).not.toHaveBeenCalled();
  });

  it('returns ready when PostgreSQL and Redis checks pass', async () => {
    const checks = passingChecks();

    await expect(healthResponse('GET', '/readyz', checks)).resolves.toEqual({
      statusCode: 200,
      body: { status: 'ready', checks: { database: 'ok', redis: 'ok' } },
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
    const response = await healthResponse('GET', '/readyz', checks);

    expect(response).toEqual({
      statusCode: 503,
      body: { status: 'not_ready', checks: { database: 'unavailable', redis: 'ok' } },
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
    const response = await healthResponse('GET', '/readyz', checks);

    expect(response).toEqual({
      statusCode: 503,
      body: { status: 'not_ready', checks: { database: 'ok', redis: 'unavailable' } },
    });
    expect(JSON.stringify(response.body)).not.toContain('private-cache');
    expect(JSON.stringify(response.body)).not.toContain('6379');
  });

  it('bounds a dependency check with a timeout', async () => {
    const checks: ReadinessChecks = {
      database: jest.fn(() => new Promise(() => undefined)),
      redis: jest.fn(async () => undefined),
    };

    await expect(healthResponse('GET', '/readyz', checks, 10)).resolves.toEqual({
      statusCode: 503,
      body: { status: 'not_ready', checks: { database: 'unavailable', redis: 'ok' } },
    });
    expect(checks.redis).toHaveBeenCalledTimes(1);
  });

  it('returns JSON for unknown health paths', async () => {
    const checks = passingChecks();
    const handler = createHealthHandler(checks);
    const result = await new Promise<{ statusCode: number; headers: IncomingHttpHeaders; body: string }>((resolve) => {
      let statusCode = 0;
      let headers: IncomingHttpHeaders = {};
      const response = {
        writeHead(code: number, values: IncomingHttpHeaders) {
          statusCode = code;
          headers = values;
        },
        end(body: string) {
          resolve({ statusCode, headers, body });
        },
      } as unknown as ServerResponse;

      handler({ method: 'GET', url: '/unknown' } as IncomingMessage, response);
    });

    expect(result.statusCode).toBe(404);
    expect(result.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(JSON.parse(result.body)).toEqual({ status: 'not_found' });
    expect(checks.database).not.toHaveBeenCalled();
    expect(checks.redis).not.toHaveBeenCalled();
  });
});
