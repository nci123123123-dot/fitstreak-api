export interface StreakResult {
  currentStreak: number;
  longestStreak: number;
  lastLogDate: string | null;
  isAliveToday: boolean;
}

export class StreakError extends Error {
  constructor(
    message: string,
    public readonly code: StreakErrorCode,
    public readonly userId?: string,
  ) {
    super(message);
    this.name = 'StreakError';
  }
}

export enum StreakErrorCode {
  INVALID_DATE_FORMAT = 'INVALID_DATE_FORMAT',
  FUTURE_DATE         = 'FUTURE_DATE',
  INVALID_USER        = 'INVALID_USER',
  DB_ERROR            = 'DB_ERROR',
}
