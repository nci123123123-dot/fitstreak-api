import { StreakError, StreakErrorCode } from '../types/streak.types';

const LOCAL_DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function validateLocalDate(date: string, userId?: string): void {
  if (!LOCAL_DATE_REGEX.test(date)) {
    throw new StreakError(
      `Invalid date format: "${date}". Expected YYYY-MM-DD.`,
      StreakErrorCode.INVALID_DATE_FORMAT,
      userId,
    );
  }
  const parsed = new Date(date + 'T00:00:00Z');
  if (isNaN(parsed.getTime())) {
    throw new StreakError(
      `Invalid calendar date: "${date}".`,
      StreakErrorCode.INVALID_DATE_FORMAT,
      userId,
    );
  }
}

/**
 * 두 YYYY-MM-DD 날짜의 일 차이 반환 (a - b)
 * UTC 기반 계산으로 DST 영향 없음
 */
export function diffInDays(a: string, b: string): number {
  const msPerDay = 86_400_000;
  const dateA = new Date(a + 'T00:00:00Z').getTime();
  const dateB = new Date(b + 'T00:00:00Z').getTime();
  return Math.round((dateA - dateB) / msPerDay);
}

/**
 * 주어진 IANA 타임존 기준 오늘 날짜를 YYYY-MM-DD 로 반환
 */
export function getTodayInTimezone(timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date());
  } catch {
    throw new StreakError(
      `Invalid timezone: "${timezone}".`,
      StreakErrorCode.INVALID_DATE_FORMAT,
    );
  }
}
