import request from 'supertest';
import { createApp } from '../app';
import { sendMail } from '../lib/mailer';
import { prisma } from '../lib/prisma';
import { verificationTokenFromMail } from '../testUtils/verificationMail';

jest.mock('../lib/mailer', () => ({
  ...jest.requireActual('../lib/mailer'),
  sendMail: jest.fn().mockResolvedValue(undefined),
}));

const app = createApp();
const mockedSendMail = sendMail as jest.MockedFunction<typeof sendMail>;

async function registerAndVerify(email: string, username: string, password = 'Password123') {
  await request(app)
    .post('/api/auth/register')
    .set('X-Eonrover-Client', '1')
    .send({ email, username, password })
    .expect(201);
  const token = verificationTokenFromMail(mockedSendMail.mock.calls, email);
  await request(app)
    .post('/api/auth/verify-email')
    .set('X-Eonrover-Client', '1')
    .send({ token })
    .expect(200);
}

describe('auth flow', () => {
  it('registers, verifies, logs in and returns the current user', async () => {
    await registerAndVerify('pilot@example.com', 'pilot1');

    const login = await request(app)
      .post('/api/auth/login')
      .set('X-Eonrover-Client', '1')
      .send({ email: 'pilot@example.com', password: 'Password123' })
      .expect(200);

    const cookie = login.headers['set-cookie'];
    expect(cookie).toBeDefined();

    const me = await request(app).get('/api/auth/me').set('Cookie', cookie).expect(200);
    expect(me.body.user.username).toBe('pilot1');
  });

  it('rejects login before email verification', async () => {
    await request(app)
      .post('/api/auth/register')
      .set('X-Eonrover-Client', '1')
      .send({ email: 'unverified@example.com', username: 'unverified1', password: 'Password123' })
      .expect(201);

    await request(app)
      .post('/api/auth/login')
      .set('X-Eonrover-Client', '1')
      .send({ email: 'unverified@example.com', password: 'Password123' })
      .expect(403);
  });

  it('rejects mutating requests without the CSRF header', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'pilot@example.com', password: 'Password123' })
      .expect(403);
  });

  it('creates exactly one homeworld with the starting resource allotment', async () => {
    await registerAndVerify('colonist@example.com', 'colonist1');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'colonist@example.com' } });
    const planets = await prisma.planet.findMany({ where: { ownerId: user.id } });
    expect(planets).toHaveLength(1);
    expect(planets[0].isHomeworld).toBe(true);
    expect(planets[0].alloy).toBe(500);
    expect(planets[0].heliox).toBe(300);
  });
});
