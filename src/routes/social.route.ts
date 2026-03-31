import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

export async function socialRoutes(
  app: FastifyInstance,
  { prisma }: { prisma: PrismaClient },
) {
  // POST /users/:targetId/follow
  app.post<{ Params: { targetId: string } }>('/users/:targetId/follow', {
    onRequest: [app.authenticate],
  }, async (req, reply) => {
    const { userId } = req.user;
    const { targetId } = req.params;

    if (userId === targetId) {
      return reply.code(400).send({ error: 'Cannot follow yourself.' });
    }

    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) return reply.code(404).send({ error: 'User not found.' });

    await prisma.follow.upsert({
      where:  { followerId_followeeId: { followerId: userId, followeeId: targetId } },
      create: { followerId: userId, followeeId: targetId },
      update: {},
    });

    return reply.code(201).send({ message: `Now following ${target.displayName}.` });
  });

  // DELETE /users/:targetId/follow
  app.delete<{ Params: { targetId: string } }>('/users/:targetId/follow', {
    onRequest: [app.authenticate],
  }, async (req, reply) => {
    const { userId } = req.user;
    const { targetId } = req.params;

    await prisma.follow.deleteMany({
      where: { followerId: userId, followeeId: targetId },
    });

    return reply.send({ message: 'Unfollowed.' });
  });

  // POST /workouts/:logId/reactions
  app.post<{
    Params: { logId: string };
    Body:   { type?: string };
  }>('/workouts/:logId/reactions', {
    onRequest: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['like', 'fire', 'strong'] },
        },
      },
    },
  }, async (req, reply) => {
    const { userId } = req.user;
    const { logId }  = req.params;
    const type       = req.body.type ?? 'like';

    const log = await prisma.workoutLog.findUnique({ where: { id: logId } });
    if (!log) return reply.code(404).send({ error: 'Workout log not found.' });

    const reaction = await prisma.reaction.upsert({
      where:  { logId_userId: { logId, userId } },
      create: { logId, userId, type },
      update: { type },
    });

    return reply.code(201).send({ reaction });
  });

  // DELETE /workouts/:logId/reactions
  app.delete<{ Params: { logId: string } }>('/workouts/:logId/reactions', {
    onRequest: [app.authenticate],
  }, async (req, reply) => {
    const { userId } = req.user;
    const { logId }  = req.params;

    await prisma.reaction.deleteMany({ where: { logId, userId } });
    return reply.send({ message: 'Reaction removed.' });
  });

  // GET /users/:userId/profile
  app.get<{ Params: { userId: string } }>('/users/:userId/profile', {
    onRequest: [app.authenticate],
  }, async (req, reply) => {
    const { userId } = req.params;

    const [user, streak, totalWorkouts, followerCount, followingCount] = await Promise.all([
      prisma.user.findUnique({
        where:  { id: userId },
        select: { id: true, displayName: true, timezone: true, createdAt: true },
      }),
      prisma.streak.findUnique({ where: { userId } }),
      prisma.workoutLog.count({ where: { userId } }),
      prisma.follow.count({ where: { followeeId: userId } }),
      prisma.follow.count({ where: { followerId: userId } }),
    ]);

    if (!user) return reply.code(404).send({ error: 'User not found.' });

    return reply.send({
      user,
      stats: {
        currentStreak:  streak?.currentStreak ?? 0,
        longestStreak:  streak?.longestStreak ?? 0,
        totalWorkouts,
        followerCount,
        followingCount,
      },
    });
  });
}
