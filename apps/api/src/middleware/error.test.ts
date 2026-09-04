import request from 'supertest';
import { createApp } from '../app';
import { SESSION_COOKIE } from '../lib/auth';
import { prisma } from '../lib/prisma';

const app = createApp();

async function playerSessionCookie(): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: 'role-check@example.com',
      username: 'role-check',
      passwordHash: 'not-used-in-this-test',
      status: 'ACTIVE',
    },
  });
  const session = await prisma.session.create({
    data: {
      id: 'role-check-session',
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  return `${SESSION_COOKIE}=${session.id}`;
}

describe('API error contract', () => {
  it('returns validation details for invalid route input', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .set('X-Eonrover-Client', '1')
      .send({ email: 'not-an-email', username: 'x', password: 'short' })
      .expect(400)
      .expect('Content-Type', /json/);

    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(typeof response.body.error).toBe('string');
    expect(response.body.details).toEqual({
      email: [expect.any(String)],
      username: [expect.any(String)],
      password: [expect.any(String)],
    });
  });

  it('returns safe JSON for a malformed JSON request', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('X-Eonrover-Client', '1')
      .send('{"email":')
      .expect(400)
      .expect('Content-Type', /json/);

    expect(response.body).toEqual({ error: 'Malformed JSON request body.', code: 'BAD_REQUEST' });
  });

  it('returns the authentication contract when a session is missing', async () => {
    const response = await request(app).get('/api/planets').expect(401).expect('Content-Type', /json/);

    expect(response.body).toEqual({ error: 'Not authenticated', code: 'UNAUTHENTICATED' });
  });

  it('returns the forbidden contract when a player lacks an administrator role', async () => {
    const response = await request(app)
      .get('/api/admin/dashboard')
      .set('Cookie', await playerSessionCookie())
      .expect(403)
      .expect('Content-Type', /json/);

    expect(response.body).toEqual({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
  });

  it('returns the forbidden contract when the CSRF header is missing', async () => {
    const response = await request(app).post('/api/auth/login').send({}).expect(403).expect('Content-Type', /json/);

    expect(response.body).toEqual({ error: 'Missing CSRF header', code: 'FORBIDDEN' });
  });

  it('returns the standard not-found contract for an unknown API route', async () => {
    const response = await request(app).get('/api/unknown').expect(404).expect('Content-Type', /json/);

    expect(response.body).toEqual({ error: 'Not found', code: 'NOT_FOUND' });
  });
});
