import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient }  from '@prisma/client';
import { StreakService }  from '../services/streak.service';
import { StreakErrorCode } from '../types/streak.types';
import { diffInDays }     from '../utils/date.util';

// ─────────────────────────────────────────────────────────────────
// 순수 함수 단위 테스트 (DB 불필요)
// ─────────────────────────────────────────────────────────────────
const svc = new StreakService(null as any);
const TODAY = '2026-03-31';

describe('computeStreak() — 순수 함수 테스트', () => {
  it('기록 없음 → 전부 0', () => {
    const r = svc.computeStreak([], TODAY);
    expect(r).toEqual({ currentStreak: 0, longestStreak: 0, lastLogDate: null, isAliveToday: false });
  });

  it('오늘만 운동 → streak 1', () => {
    const r = svc.computeStreak(['2026-03-31'], TODAY);
    expect(r.currentStreak).toBe(1);
    expect(r.isAliveToday).toBe(false);
  });

  it('3일 연속 (오늘 포함) → streak 3', () => {
    const r = svc.computeStreak(['2026-03-31', '2026-03-30', '2026-03-29'], TODAY);
    expect(r.currentStreak).toBe(3);
    expect(r.longestStreak).toBe(3);
  });

  it('어제까지만 운동 → streak 유지 + isAliveToday=true', () => {
    const r = svc.computeStreak(['2026-03-30', '2026-03-29', '2026-03-28'], TODAY);
    expect(r.currentStreak).toBe(3);
    expect(r.isAliveToday).toBe(true);
  });

  it('2일 전이 마지막 → streak 0 초기화', () => {
    const r = svc.computeStreak(['2026-03-29', '2026-03-28'], TODAY);
    expect(r.currentStreak).toBe(0);
    expect(r.isAliveToday).toBe(false);
  });

  it('중간에 하루 빠짐 → 빠진 시점에서 끊김', () => {
    // 3/31, 3/30, (3/29 없음), 3/28
    const r = svc.computeStreak(['2026-03-31', '2026-03-30', '2026-03-28'], TODAY);
    expect(r.currentStreak).toBe(2);
  });

  it('longestStreak는 과거 최장 기록 보존', () => {
    // 현재 2일 streak, 과거에 5일 연속
    const dates = [
      '2026-03-31', '2026-03-30',
      '2026-03-25', '2026-03-24', '2026-03-23', '2026-03-22', '2026-03-21',
    ];
    const r = svc.computeStreak(dates, TODAY);
    expect(r.currentStreak).toBe(2);
    expect(r.longestStreak).toBe(5);
  });

  it('월 경계 넘는 연속 → 정확히 계산', () => {
    const r = svc.computeStreak(['2026-04-01', '2026-03-31', '2026-03-30'], '2026-04-01');
    expect(r.currentStreak).toBe(3);
  });

  it('윤년 경계 (2024-02-29) → 정확히 계산', () => {
    const r = svc.computeStreak(['2024-03-01', '2024-02-29', '2024-02-28'], '2024-03-01');
    expect(r.currentStreak).toBe(3);
  });

  it('366일 연속 → streak 366 (성능)', () => {
    const dates: string[] = [];
    for (let i = 0; i < 366; i++) {
      const d = new Date('2026-03-31T00:00:00Z');
      d.setUTCDate(d.getUTCDate() - i);
      dates.push(d.toISOString().slice(0, 10));
    }
    const start = performance.now();
    const r = svc.computeStreak(dates, TODAY);
    const elapsed = performance.now() - start;

    expect(r.currentStreak).toBe(366);
    expect(elapsed).toBeLessThan(50); // 50ms 이내
  });
});

// ─────────────────────────────────────────────────────────────────
// 예외 처리 테스트
// ─────────────────────────────────────────────────────────────────
describe('예외 처리', () => {
  it('미래 날짜 → FUTURE_DATE', async () => {
    await expect(
      svc.recordWorkoutAndRecalculate('user-1', '2099-01-01', 'Asia/Seoul'),
    ).rejects.toMatchObject({ code: StreakErrorCode.FUTURE_DATE });
  });

  it('잘못된 날짜 형식 → INVALID_DATE_FORMAT', async () => {
    await expect(
      svc.recordWorkoutAndRecalculate('user-1', '2026/03/31', 'Asia/Seoul'),
    ).rejects.toMatchObject({ code: StreakErrorCode.INVALID_DATE_FORMAT });
  });

  it('빈 userId → INVALID_USER', async () => {
    await expect(
      svc.recordWorkoutAndRecalculate('', '2026-03-31', 'Asia/Seoul'),
    ).rejects.toMatchObject({ code: StreakErrorCode.INVALID_USER });
  });

  it('잘못된 timezone → INVALID_DATE_FORMAT', async () => {
    await expect(
      svc.recordWorkoutAndRecalculate('user-1', '2026-03-31', 'Mars/Olympus'),
    ).rejects.toMatchObject({ code: StreakErrorCode.INVALID_DATE_FORMAT });
  });
});

// ─────────────────────────────────────────────────────────────────
// 날짜 유틸 테스트
// ─────────────────────────────────────────────────────────────────
describe('diffInDays()', () => {
  it('연속 날짜 → 1', () => expect(diffInDays('2026-03-31', '2026-03-30')).toBe(1));
  it('월 경계  → 1', () => expect(diffInDays('2026-04-01', '2026-03-31')).toBe(1));
  it('윤년 경계 → 1', () => expect(diffInDays('2024-03-01', '2024-02-29')).toBe(1));
  it('같은 날  → 0', () => expect(diffInDays('2026-03-31', '2026-03-31')).toBe(0));
  it('역방향   → 음수', () => expect(diffInDays('2026-03-30', '2026-03-31')).toBe(-1));
  it('1년 차이 → 365', () => expect(diffInDays('2026-03-31', '2025-03-31')).toBe(365));
});

// ─────────────────────────────────────────────────────────────────
// 통합 테스트 (실제 SQLite DB)
// ─────────────────────────────────────────────────────────────────
describe('통합 테스트 (SQLite)', () => {
  let prisma: PrismaClient;
  let service: StreakService;
  let testUserId: string;

  beforeAll(async () => {
    prisma  = new PrismaClient({ datasources: { db: { url: 'file:./prisma/test.db' } } });
    service = new StreakService(prisma);
    await prisma.$connect();

    // 테스트용 사용자 생성
    const user = await prisma.user.create({
      data: {
        email:        `test_${Date.now()}@fitstreak.dev`,
        displayName:  'Test User',
        passwordHash: 'hashed',
        timezone:     'Asia/Seoul',
      },
    });
    testUserId = user.id;
  });

  afterAll(async () => {
    await prisma.workoutLog.deleteMany({ where: { userId: testUserId } });
    await prisma.streak.deleteMany({ where: { userId: testUserId } });
    await prisma.user.delete({ where: { id: testUserId } });
    await prisma.$disconnect();
  });

  it('첫 운동 기록 → streak 1', async () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
    const { streakResult } = await service.recordWorkoutAndRecalculate(
      testUserId, today, 'Asia/Seoul',
    );
    expect(streakResult.currentStreak).toBe(1);
    expect(streakResult.lastLogDate).toBe(today);
  });

  it('같은 날 중복 기록 → alreadyLoggedToday=true, streak 유지', async () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
    const { streakResult, alreadyLoggedToday } = await service.recordWorkoutAndRecalculate(
      testUserId, today, 'Asia/Seoul',
    );
    expect(alreadyLoggedToday).toBe(true);
    expect(streakResult.currentStreak).toBe(1); // streak 변화 없음
  });

  it('streak 조회 → DB 캐시 값과 일치', async () => {
    const streak = await service.getStreak(testUserId, 'Asia/Seoul');
    expect(streak.currentStreak).toBeGreaterThanOrEqual(1);
  });
});
