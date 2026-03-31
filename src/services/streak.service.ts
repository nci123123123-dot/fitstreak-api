import { PrismaClient } from '@prisma/client';
import { StreakError, StreakErrorCode, StreakResult } from '../types/streak.types';
import { validateLocalDate, diffInDays, getTodayInTimezone } from '../utils/date.util';

const MAX_LOOKBACK_DAYS = 366;

export class StreakService {
  constructor(private readonly prisma: PrismaClient) {}

  // ──────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────

  /**
   * 워크아웃 기록 + streak 재계산 (트랜잭션)
   */
  async recordWorkoutAndRecalculate(
    userId: string,
    localDate: string,
    timezone: string,
    extra?: { note?: string; photoUrl?: string; gpsVerified?: boolean },
  ): Promise<{ streakResult: StreakResult; alreadyLoggedToday: boolean }> {
    this.validateInputs(userId, localDate, timezone);

    const today = getTodayInTimezone(timezone);

    if (localDate > today) {
      throw new StreakError(
        `Cannot log workout for a future date: "${localDate}".`,
        StreakErrorCode.FUTURE_DATE,
        userId,
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // 같은 날 중복 기록 확인
        const existing = await tx.workoutLog.findUnique({
          where: { userId_localDate: { userId, localDate } },
          select: { id: true },
        });

        if (existing) {
          const streakResult = await this.computeStreakFromDB(userId, today, tx);
          return { streakResult, alreadyLoggedToday: true };
        }

        await tx.workoutLog.create({
          data: {
            userId,
            localDate,
            note:        extra?.note ?? null,
            photoUrl:    extra?.photoUrl ?? null,
            gpsVerified: extra?.gpsVerified ?? false,
          },
        });

        const streakResult = await this.computeStreakFromDB(userId, today, tx);
        return { streakResult, alreadyLoggedToday: false };
      });
    } catch (error) {
      if (error instanceof StreakError) throw error;
      throw new StreakError(
        `DB error for user "${userId}": ${(error as Error).message}`,
        StreakErrorCode.DB_ERROR,
        userId,
      );
    }
  }

  /**
   * 현재 streak 조회 (읽기 전용)
   */
  async getStreak(userId: string, timezone: string): Promise<StreakResult> {
    if (!userId?.trim()) {
      throw new StreakError('userId is required.', StreakErrorCode.INVALID_USER);
    }
    const today = getTodayInTimezone(timezone);

    try {
      return await this.computeStreakFromDB(userId, today, this.prisma);
    } catch (error) {
      if (error instanceof StreakError) throw error;
      throw new StreakError(
        `DB error fetching streak for "${userId}".`,
        StreakErrorCode.DB_ERROR,
        userId,
      );
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Core Streak Engine (순수 함수 — 단위 테스트 가능)
  // ──────────────────────────────────────────────────────────────

  /**
   * 날짜 배열(DESC 정렬, 중복 없음)로 streak 계산
   *
   * 규칙:
   *  - 오늘 또는 어제 연속 로그 → currentStreak 유지
   *  - 2일 이상 공백 → currentStreak = 0
   *  - 오늘 미기록 + 어제까지 연속 → isAliveToday = true (streak는 살아있음)
   */
  computeStreak(sortedDatesDesc: string[], today: string): StreakResult {
    if (sortedDatesDesc.length === 0) {
      return { currentStreak: 0, longestStreak: 0, lastLogDate: null, isAliveToday: false };
    }

    const lastLogDate = sortedDatesDesc[0];
    const daysSinceLastLog = diffInDays(today, lastLogDate);

    // streak 소멸: 마지막 로그가 2일 이상 전
    if (daysSinceLastLog >= 2) {
      const longestStreak = this.computeLongestStreak(sortedDatesDesc);
      return { currentStreak: 0, longestStreak, lastLogDate, isAliveToday: false };
    }

    const isAliveToday = daysSinceLastLog === 1; // 어제까지 운동, 오늘 아직 안 함

    // 가장 최근 날짜부터 역방향으로 연속 카운트
    let currentStreak = 1;
    for (let i = 1; i < sortedDatesDesc.length; i++) {
      const gap = diffInDays(sortedDatesDesc[i - 1], sortedDatesDesc[i]);
      if (gap === 1) {
        currentStreak++;
      } else {
        break; // 하루라도 빠지면 즉시 종료
      }
    }

    const longestStreak = Math.max(
      this.computeLongestStreak(sortedDatesDesc),
      currentStreak,
    );

    return { currentStreak, longestStreak, lastLogDate, isAliveToday };
  }

  // ──────────────────────────────────────────────────────────────
  // Private
  // ──────────────────────────────────────────────────────────────

  private async computeStreakFromDB(
    userId: string,
    today: string,
    tx: any,
  ): Promise<StreakResult> {
    // SQLite용: GROUP BY로 distinct dates 추출
    const rows: { localDate: string }[] = await tx.workoutLog.findMany({
      where:   { userId },
      select:  { localDate: true },
      distinct: ['localDate'],
      orderBy: { localDate: 'desc' },
      take:    MAX_LOOKBACK_DAYS,
    });

    const dates = rows.map((r) => r.localDate);
    const result = this.computeStreak(dates, today);

    // streak 테이블 갱신 (최신 상태 캐싱)
    await tx.streak.upsert({
      where:  { userId },
      create: {
        userId,
        currentStreak: result.currentStreak,
        longestStreak: result.longestStreak,
        lastLogDate:   result.lastLogDate,
        updatedAt:     new Date(),
      },
      update: {
        currentStreak: result.currentStreak,
        longestStreak: result.longestStreak,
        lastLogDate:   result.lastLogDate,
        updatedAt:     new Date(),
      },
    });

    return result;
  }

  /** 전체 날짜 배열에서 역대 최장 연속 일수 계산 (O(n)) */
  private computeLongestStreak(sortedDatesDesc: string[]): number {
    if (sortedDatesDesc.length === 0) return 0;

    let maxRun = 1;
    let curRun = 1;

    for (let i = 1; i < sortedDatesDesc.length; i++) {
      const gap = diffInDays(sortedDatesDesc[i - 1], sortedDatesDesc[i]);
      if (gap === 1) {
        curRun++;
        if (curRun > maxRun) maxRun = curRun;
      } else {
        curRun = 1;
      }
    }

    return maxRun;
  }

  private validateInputs(userId: string, localDate: string, timezone: string): void {
    if (!userId?.trim()) {
      throw new StreakError('userId is required.', StreakErrorCode.INVALID_USER);
    }
    validateLocalDate(localDate, userId);
    getTodayInTimezone(timezone); // timezone 유효성 검사 겸용
  }
}
