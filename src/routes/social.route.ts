import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { getTodayInTimezone } from '../utils/date.util';

const NUDGE_DAILY_LIMIT = 3;

// Expo Push Notification 전송
async function sendExpoPush(
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>,
) {
  if (tokens.length === 0) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(
        tokens.map((to) => ({ to, title, body, data, sound: 'default' })),
      ),
    });
  } catch {
    // push 실패는 무시 — 핵심 기능이 아님
  }
}

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

  // GET /users/search?q= — 유저 검색
  app.get<{ Querystring: { q?: string } }>('/users/search', {
    onRequest: [app.authenticate],
  }, async (req, reply) => {
    const { userId } = req.user;
    const q = (req.query.q ?? '').trim();
    if (!q) return reply.send({ users: [] });

    const results = await prisma.user.findMany({
      where: {
        id:  { not: userId },
        displayName: { contains: q },
      },
      select: { id: true, displayName: true, profilePhoto: true },
      take: 20,
    });

    // 현재 유저의 팔로우 관계 조회
    const myFollowing = await prisma.follow.findMany({
      where: { followerId: userId, followeeId: { in: results.map(u => u.id) } },
      select: { followeeId: true },
    });
    const myFollowers = await prisma.follow.findMany({
      where: { followeeId: userId, followerId: { in: results.map(u => u.id) } },
      select: { followerId: true },
    });
    const followingSet = new Set(myFollowing.map(f => f.followeeId));
    const followerSet  = new Set(myFollowers.map(f => f.followerId));

    const users = results.map(u => ({
      ...u,
      isFollowing: followingSet.has(u.id),
      isFollower:  followerSet.has(u.id),
    }));

    return reply.send({ users });
  });

  // GET /users/me — 내 정보 (헬스장 + 프로필 사진 포함)
  app.get('/users/me', {
    onRequest: [app.authenticate],
  }, async (req, reply) => {
    const { userId } = req.user;
    const user = await prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, displayName: true, timezone: true, gymName: true, gymLat: true, gymLng: true, defaultVisibility: true, profilePhoto: true },
    });
    if (!user) return reply.code(404).send({ error: 'User not found.' });
    return reply.send({ user });
  });

  // PATCH /users/me/profile — 이름 + 프로필 사진 수정
  app.patch<{
    Body: { displayName?: string; profilePhoto?: string | null };
  }>('/users/me/profile', {
    onRequest: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          displayName:  { type: 'string', minLength: 1, maxLength: 50 },
          profilePhoto: { type: ['string', 'null'] },
        },
      },
    },
  }, async (req, reply) => {
    const { userId } = req.user;
    const { displayName, profilePhoto } = req.body;
    const data: Record<string, unknown> = {};
    if (displayName  !== undefined) data.displayName  = displayName;
    if (profilePhoto !== undefined) data.profilePhoto = profilePhoto;
    if (Object.keys(data).length === 0) return reply.code(400).send({ error: 'Nothing to update.' });
    const updated = await prisma.user.update({
      where:  { id: userId },
      data,
      select: { id: true, displayName: true, profilePhoto: true },
    });
    return reply.send({ user: updated });
  });

  // GET /users/me/schedule — 운동 스케줄 조회
  app.get('/users/me/schedule', {
    onRequest: [app.authenticate],
  }, async (req, reply) => {
    const { userId } = req.user;
    const schedule = await prisma.workoutSchedule.findUnique({ where: { userId } });
    const daysOfWeek: number[] = schedule?.daysOfWeek
      ? JSON.parse(schedule.daysOfWeek)
      : [1, 2, 3, 4, 5]; // 기본값: 월~금
    return reply.send({ daysOfWeek });
  });

  // PUT /users/me/schedule — 운동 스케줄 저장
  app.put<{
    Body: { daysOfWeek: number[] };
  }>('/users/me/schedule', {
    onRequest: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['daysOfWeek'],
        properties: {
          daysOfWeek: {
            type: 'array',
            items: { type: 'integer', minimum: 0, maximum: 6 },
            maxItems: 7,
          },
        },
      },
    },
  }, async (req, reply) => {
    const { userId } = req.user;
    const days = [...new Set(req.body.daysOfWeek)].sort();
    await prisma.workoutSchedule.upsert({
      where:  { userId },
      create: { userId, daysOfWeek: JSON.stringify(days), timeLocal: '07:00' },
      update: { daysOfWeek: JSON.stringify(days) },
    });
    return reply.send({ daysOfWeek: days });
  });

  // PUT /users/me/gym — 헬스장 위치 등록
  app.put<{
    Body: { gymName?: string; gymLat: number; gymLng: number };
  }>('/users/me/gym', {
    onRequest: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['gymLat', 'gymLng'],
        properties: {
          gymName: { type: 'string', maxLength: 100 },
          gymLat:  { type: 'number' },
          gymLng:  { type: 'number' },
        },
      },
    },
  }, async (req, reply) => {
    const { userId } = req.user;
    const { gymName, gymLat, gymLng } = req.body;
    await prisma.user.update({
      where: { id: userId },
      data:  { gymName: gymName ?? '내 헬스장', gymLat, gymLng },
    });
    return reply.send({ message: '헬스장 위치가 등록되었습니다.' });
  });

  // PATCH /users/me/visibility — 기본 공개 범위 설정
  app.patch<{
    Body: { defaultVisibility: string };
  }>('/users/me/visibility', {
    onRequest: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['defaultVisibility'],
        properties: {
          defaultVisibility: { type: 'string', enum: ['public', 'friends', 'private'] },
        },
      },
    },
  }, async (req, reply) => {
    const { userId } = req.user;
    await prisma.user.update({
      where: { id: userId },
      data:  { defaultVisibility: req.body.defaultVisibility },
    });
    return reply.send({ message: '공개 범위가 업데이트되었습니다.' });
  });

  // GET /users/:userId/followers
  app.get<{ Params: { userId: string } }>('/users/:userId/followers', {
    onRequest: [app.authenticate],
  }, async (req, reply) => {
    const { userId } = req.params;
    const rows = await prisma.follow.findMany({
      where:  { followeeId: userId },
      select: { follower: { select: { id: true, displayName: true } } },
    });
    return reply.send({ users: rows.map((r) => r.follower) });
  });

  // GET /users/:userId/following
  app.get<{ Params: { userId: string } }>('/users/:userId/following', {
    onRequest: [app.authenticate],
  }, async (req, reply) => {
    const { userId } = req.params;
    const rows = await prisma.follow.findMany({
      where:  { followerId: userId },
      select: { followee: { select: { id: true, displayName: true } } },
    });
    return reply.send({ users: rows.map((r) => r.followee) });
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
        lastLogDate:    streak?.lastLogDate ?? null,
        totalWorkouts,
        followerCount,
        followingCount,
      },
    });
  });

  // POST /users/me/push-token — 푸시 토큰 등록
  app.post<{
    Body: { token: string; platform: string };
  }>('/users/me/push-token', {
    onRequest: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['token', 'platform'],
        properties: {
          token:    { type: 'string' },
          platform: { type: 'string', enum: ['ios', 'android'] },
        },
      },
    },
  }, async (req, reply) => {
    const { userId } = req.user;
    const { token, platform } = req.body;
    await prisma.pushToken.upsert({
      where:  { userId_token: { userId, token } },
      create: { userId, token, platform },
      update: { platform, updatedAt: new Date() },
    });
    return reply.code(201).send({ message: 'Push token registered.' });
  });

  // GET /users/me/friends/ranking — 맞팔 친구 + 나 스트릭 랭킹
  app.get('/users/me/friends/ranking', {
    onRequest: [app.authenticate],
  }, async (req, reply) => {
    const { userId } = req.user;

    const [myFollowing, myFollowers] = await Promise.all([
      prisma.follow.findMany({ where: { followerId: userId }, select: { followeeId: true } }),
      prisma.follow.findMany({ where: { followeeId: userId }, select: { followerId: true } }),
    ]);
    const followingSet = new Set(myFollowing.map((f) => f.followeeId));
    const followerSet  = new Set(myFollowers.map((f) => f.followerId));
    const mutualIds    = [...followingSet].filter((id) => followerSet.has(id));
    const allIds       = [userId, ...mutualIds];

    const [users, streaks, todayLogs] = await Promise.all([
      prisma.user.findMany({
        where:  { id: { in: allIds } },
        select: { id: true, displayName: true, profilePhoto: true },
      }),
      prisma.streak.findMany({
        where:  { userId: { in: allIds } },
        select: { userId: true, currentStreak: true, longestStreak: true, lastLogDate: true },
      }),
      prisma.workoutLog.findMany({
        where:  { userId: { in: allIds }, localDate: { gte: new Date().toISOString().slice(0, 10) } },
        select: { userId: true },
      }),
    ]);

    const streakMap     = new Map(streaks.map((s) => [s.userId, s]));
    const workedOutSet  = new Set(todayLogs.map((l) => l.userId));

    const ranking = users
      .map((u) => {
        const s = streakMap.get(u.id);
        return {
          id:             u.id,
          displayName:    u.displayName,
          profilePhoto:   u.profilePhoto,
          currentStreak:  s?.currentStreak ?? 0,
          longestStreak:  s?.longestStreak ?? 0,
          workedOutToday: workedOutSet.has(u.id),
          isMe:           u.id === userId,
        };
      })
      .sort((a, b) => b.currentStreak - a.currentStreak);

    return reply.send({ ranking });
  });

  // GET /users/me/friends/status — 맞팔 친구 오늘 운동 현황 + 오늘 내 nudge 현황
  app.get('/users/me/friends/status', {
    onRequest: [app.authenticate],
  }, async (req, reply) => {
    const { userId } = req.user;

    const me = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const today = getTodayInTimezone(me?.timezone ?? 'Asia/Seoul');

    // 맞팔로우: 내가 팔로우하는 사람 중 나를 팔로우하는 사람
    const [myFollowing, myFollowers] = await Promise.all([
      prisma.follow.findMany({ where: { followerId: userId }, select: { followeeId: true } }),
      prisma.follow.findMany({ where: { followeeId: userId }, select: { followerId: true } }),
    ]);

    const followingSet  = new Set(myFollowing.map((f) => f.followeeId));
    const followerSet   = new Set(myFollowers.map((f) => f.followerId));
    const mutualIds     = [...followingSet].filter((id) => followerSet.has(id));

    if (mutualIds.length === 0) {
      const nudgesSentToday = await prisma.nudgeLog.count({
        where: { senderId: userId, sentDate: today },
      });
      return reply.send({ friends: [], nudgesSentToday, nudgeLimit: NUDGE_DAILY_LIMIT });
    }

    // 맞팔 친구들의 오늘 운동 기록 조회
    const [friendUsers, todayLogs, nudgesSentToday, nudgesSentToFriendsToday] = await Promise.all([
      prisma.user.findMany({
        where:  { id: { in: mutualIds } },
        select: { id: true, displayName: true },
      }),
      prisma.workoutLog.findMany({
        where:  { userId: { in: mutualIds }, localDate: today },
        select: { userId: true },
      }),
      prisma.nudgeLog.count({
        where: { senderId: userId, sentDate: today },
      }),
      prisma.nudgeLog.findMany({
        where:  { senderId: userId, receiverId: { in: mutualIds }, sentDate: today },
        select: { receiverId: true },
      }),
    ]);

    const workedOutSet   = new Set(todayLogs.map((l) => l.userId));
    const nudgedTodaySet = new Set(nudgesSentToFriendsToday.map((n) => n.receiverId));

    const friends = friendUsers.map((u) => ({
      id:           u.id,
      displayName:  u.displayName,
      workedOutToday: workedOutSet.has(u.id),
      nudgedToday:    nudgedTodaySet.has(u.id),
    }));

    return reply.send({ friends, nudgesSentToday, nudgeLimit: NUDGE_DAILY_LIMIT });
  });

  // POST /users/:targetId/nudge — 운동 독려 알림 보내기
  app.post<{ Params: { targetId: string } }>('/users/:targetId/nudge', {
    onRequest: [app.authenticate],
  }, async (req, reply) => {
    const { userId }   = req.user;
    const { targetId } = req.params;

    if (userId === targetId) {
      return reply.code(400).send({ error: '자신에게 nudge를 보낼 수 없어요.' });
    }

    const me = await prisma.user.findUnique({
      where:  { id: userId },
      select: { timezone: true, displayName: true },
    });
    if (!me) return reply.code(404).send({ error: 'User not found.' });

    const today = getTodayInTimezone(me.timezone);

    // 오늘 nudge 횟수 확인 (3회 제한)
    const todayCount = await prisma.nudgeLog.count({
      where: { senderId: userId, sentDate: today },
    });
    if (todayCount >= NUDGE_DAILY_LIMIT) {
      return reply.code(429).send({
        error: `오늘 nudge를 이미 ${NUDGE_DAILY_LIMIT}회 보냈어요. 내일 다시 시도해보세요.`,
        remaining: 0,
      });
    }

    // 맞팔 확인
    const [iFollow, theyFollow] = await Promise.all([
      prisma.follow.findUnique({
        where: { followerId_followeeId: { followerId: userId,   followeeId: targetId } },
      }),
      prisma.follow.findUnique({
        where: { followerId_followeeId: { followerId: targetId, followeeId: userId } },
      }),
    ]);
    if (!iFollow || !theyFollow) {
      return reply.code(403).send({ error: '맞팔로우 친구에게만 nudge를 보낼 수 있어요.' });
    }

    // 대상이 오늘 이미 운동했는지 확인
    const targetTimezone = (await prisma.user.findUnique({
      where: { id: targetId }, select: { timezone: true },
    }))?.timezone ?? 'Asia/Seoul';
    const targetToday = getTodayInTimezone(targetTimezone);

    const alreadyWorkedOut = await prisma.workoutLog.findUnique({
      where: { userId_localDate: { userId: targetId, localDate: targetToday } },
    });
    if (alreadyWorkedOut) {
      return reply.code(400).send({ error: '이미 오늘 운동한 친구예요!' });
    }

    // nudge 기록 저장
    await prisma.nudgeLog.create({
      data: { senderId: userId, receiverId: targetId, sentDate: today },
    });

    // 푸시 알림 전송
    const pushTokens = await prisma.pushToken.findMany({
      where:  { userId: targetId },
      select: { token: true },
    });
    await sendExpoPush(
      pushTokens.map((t) => t.token),
      '🏋️ 운동 독려',
      `${me.displayName}님이 운동하러 가라고 했어요!`,
      { type: 'nudge', senderId: userId },
    );

    return reply.code(201).send({
      message: 'Nudge sent!',
      remaining: NUDGE_DAILY_LIMIT - todayCount - 1,
    });
  });
}
