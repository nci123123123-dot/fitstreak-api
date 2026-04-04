import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { StreakService } from '../services/streak.service';
import { StreakError } from '../types/streak.types';
import { getTodayInTimezone } from '../utils/date.util';
import { advanceSplitSlot } from './split.route';

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
          note:        { type: 'string' },
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

      // 새 기록일 때만 분할 슬롯 전진
      if (!alreadyLoggedToday) {
        await advanceSplitSlot(prisma, userId);
      }

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

  // PUT /workouts/:logId — 내 운동 기록 수정
  app.put<{
    Params: { logId: string };
    Body:   { note?: string; visibility?: string; photoUrl?: string };
  }>('/workouts/:logId', {
    onRequest: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          note:       { type: 'string', maxLength: 2000 },
          visibility: { type: 'string', enum: ['public', 'friends', 'private'] },
          photoUrl:   { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { userId } = req.user;
    const { logId }  = req.params;

    const log = await prisma.workoutLog.findUnique({ where: { id: logId } });
    if (!log)              return reply.code(404).send({ error: 'Not found.' });
    if (log.userId !== userId) return reply.code(403).send({ error: 'Forbidden.' });

    const updated = await prisma.workoutLog.update({
      where: { id: logId },
      data:  {
        ...(req.body.note       !== undefined && { note:       req.body.note }),
        ...(req.body.visibility !== undefined && { visibility: req.body.visibility }),
        ...(req.body.photoUrl   !== undefined && { photoUrl:   req.body.photoUrl }),
      },
    });
    return reply.send({ log: updated });
  });

  // GET /workouts/calendar?year=YYYY&month=MM
  app.get<{
    Querystring: { year?: string; month?: string };
  }>('/workouts/calendar', {
    onRequest: [app.authenticate],
  }, async (req, reply) => {
    const { userId } = req.user;
    const year  = parseInt(req.query.year  ?? String(new Date().getFullYear()));
    const month = parseInt(req.query.month ?? String(new Date().getMonth() + 1));
    const pad   = (n: number) => String(n).padStart(2, '0');
    const start = `${year}-${pad(month)}-01`;
    const end   = `${year}-${pad(month)}-31`;

    const logs = await prisma.workoutLog.findMany({
      where:   { userId, localDate: { gte: start, lte: end } },
      select:  { id: true, localDate: true, photoUrl: true, note: true, gpsVerified: true },
      orderBy: { localDate: 'asc' },
    });
    return reply.send({ logs });
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

    // 요청한 유저의 timezone 기준 오늘 날짜
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } });
    const today = getTodayInTimezone(me?.timezone ?? 'Asia/Seoul');

    const followingOnlyIds = followingIds.map((f) => f.followeeId);

    // 오늘 기록만 조회
    const allLogs = await prisma.workoutLog.findMany({
      where: {
        AND: [
          { localDate: today },
          {
            OR: [
              // 내 기록: visibility 무관, 항상 표시
              { userId },
              // 친구 기록: public 또는 friends만
              { userId: { in: followingOnlyIds }, visibility: { in: ['public', 'friends'] } },
            ],
          },
          ...(cursor ? [{ loggedAt: { lt: new Date(cursor) } }] : []),
        ],
      },
      orderBy: { loggedAt: 'desc' },
      take:    limit * 3, // 중복 제거 후 limit 개수 확보를 위해 여유롭게 조회
      include: {
        user:      { select: { id: true, displayName: true } },
        reactions: { select: { type: true, userId: true } },
      },
    });

    // 유저+날짜 기준 중복 제거 (같은 날 여러 번 기록해도 1개만)
    const seen = new Set<string>();
    const logs = allLogs.filter((log) => {
      const key = `${log.userId}_${log.localDate}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, limit);

    const nextCursor = logs.length === limit
      ? logs[logs.length - 1].loggedAt.toISOString()
      : null;

    return reply.send({ logs, nextCursor });
  });
}

