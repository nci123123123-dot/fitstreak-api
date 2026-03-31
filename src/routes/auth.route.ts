import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

function hashPassword(pw: string): string {
  // 실서비스에서는 bcrypt 사용. 로컬 개발용 단순 해시.
  return createHash('sha256').update(pw + 'fitstreak-salt').digest('hex');
}

export async function authRoutes(app: FastifyInstance, { prisma }: { prisma: PrismaClient }) {
  // POST /auth/register
  app.post<{
    Body: { email: string; displayName: string; password: string; timezone?: string };
  }>('/auth/register', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'displayName', 'password'],
        properties: {
          email:       { type: 'string', format: 'email' },
          displayName: { type: 'string', minLength: 1, maxLength: 50 },
          password:    { type: 'string', minLength: 6 },
          timezone:    { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { email, displayName, password, timezone = 'Asia/Seoul' } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.code(409).send({ error: 'Email already registered.' });
    }

    const user = await prisma.user.create({
      data: { email, displayName, passwordHash: hashPassword(password), timezone },
      select: { id: true, email: true, displayName: true, timezone: true },
    });

    const token = app.jwt.sign({ userId: user.id, email: user.email });
    return reply.code(201).send({ user, token });
  });

  // POST /auth/login
  app.post<{
    Body: { email: string; password: string };
  }>('/auth/login', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email:    { type: 'string' },
          password: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.passwordHash !== hashPassword(password)) {
      return reply.code(401).send({ error: 'Invalid email or password.' });
    }

    const token = app.jwt.sign({ userId: user.id, email: user.email });
    return reply.send({
      user: { id: user.id, email: user.email, displayName: user.displayName, timezone: user.timezone },
      token,
    });
  });
}
