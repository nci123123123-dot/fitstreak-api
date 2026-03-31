import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { StreakService } from '../services/streak.service';
import { StreakError } from '../types/streak.types';
import { getTodayInTimezone } from '../utils/date.util';

export async function workoutRoutes(
  app: FastifyInstance,
  { prisma, streakService }: { prisma: PrismaClient; streakService: StreakService },
) {
  // POST /workouts — 오늘 운동 기록
  app.post<{
    Body: { note?: string; photoUrl?: string; gpsVerified?: boolean; localDate?: string };
  }>('/workouts', {
    onRequest: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          note:        { type: 'string', maxLength: 280 },
          photoUrl:    { type: 'string' },
          gpsVerified: { type: 'boolean' },
          localDate:   { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        },
      },
    },
  }, async (req, reply) => {
    const { userId } = req.user;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });

    if (!user) return reply.code(404).send({ error: 'User not found.' });

    // 클라이언트가 localDate를 안 보내면 서버에서 사용자 TZ 기준 오늘 날짜 사용
    const localDate = req.body.localDate ?? getTodayInTimezone(user.timezone);

    try {
      const { streakResult, alreadyLoggedToday } =
        await streakService.recordWorkoutAndRecalculate(userId, localDate, user.timezone, {
          note:        req.body.note,
          photoUrl:    req.body.photoUrl,
          gpsVerified: req.body.gpsVerified,
        });

      return reply.code(alreadyLoggedToday ? 200 : 201).send({
        message:         alreadyLoggedToday ? 'Already logged today.' : 'Workout recorded!',
        alreadyLogged:   alreadyLoggedToday,
        localDate,
        streak:          streakResult,
      });
    } catch (error) {
      if (error instanceof StreakError) {
        return reply.code(400).send({ error: error.message, code: error.code });
      }
      throw error;
    }
  });

  // GET /workouts — 내 운동 기록 목록
  app.get<{
    Querystring: { page?: string; limit?: string };
  }>('/workouts', {
    onRequest: [app.authenticate],
  }, async (req, reply) => {
    const { userId } = req.user;
    const page  = Math.max(1, parseInt(req.query.page  ?? '1'));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit ?? '20')));

    const [logs, total] = await Promise.all([
      prisma.workoutLog.findMany({
        where:   { userId },
        orderBy: { localDate: 'desc' },
        skip:    (page - 1) * limit,
        take:    limit,
        select: {
          id: true, localDate: true, loggedAt: true,
          note: true, photoUrl: true, gpsVerified: true, visibility: true,
          reactions: { select: { type: true, userId: true } },
        },
      }),
      prisma.workoutLog.count({ where: { userId } }),
    ]);

    return reply.send({ logs, total, page, limit, totalPages: Math.ceil(total / limit) });
  });

  // GET /workouts/streak — 내 streak 조회
  app.get('/workouts/streak', {
    onRequest: [app.authenticate],
  }, async (req, reply) => {
    const { userId } = req.user;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });

    if (!user) return reply.code(404).send({ error: 'User not found.' });

    const streak = await streakService.getStreak(userId, user.timezone);
    return reply.send({ streak });
  });

  // GET /workouts/feed — 친구 피드
  app.get<{
    Querystring: { cursor?: string; limit?: string };
  }>('/workouts/feed', {
    onRequest: [app.authenticate],
  }, async (req, reply) => {
    const { userId } = req.user;
    const limit  = Math.min(20, parseInt(req.query.limit ?? '10'));
    const cursor = req.query.cursor;

    // 내가 팔로우하는 사람들의 public/friends 게시물
    const followingIds = await prisma.follow.findMany({
      where:  { followerId: userId },
      select: { followeeId: true },
    });
    const ids = [userId, ...followingIds.map((f) => f.followeeId)];

    const logs = await prisma.workoutLog.findMany({
      where: {
        userId:     { in: ids },
        visibility: { in: ['public', 'friends'] },
        ...(cursor ? { loggedAt: { lt: new Date(cursor) } } : {}),
      },
      orderBy: { loggedAt: 'desc' },
      take:    limit,
      include: {
        user:      { select: { id: true, displayName: true } },
        reactions: { select: { type: true, userId: true } },
      },
    });

    const nextCursor = logs.length === limit
      ? logs[logs.length - 1].loggedAt.toISOString()
      : null;

    return reply.send({ logs, nextCursor });
  });
}

