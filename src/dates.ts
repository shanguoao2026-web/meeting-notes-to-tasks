import { InputError } from './errors.js';

/** A due phrase found inside a sentence. `end` is exclusive. */
export interface DueMatch {
  due: string;
  start: number;
  end: number;
}

interface Hit extends DueMatch {
  relative: boolean;
}

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

const MONTH_PATTERN = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join('|');

const WEEKDAY_SUN0: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tues: 2,
  tue: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thurs: 4,
  thur: 4,
  thu: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

const WEEKDAY_PATTERN = Object.keys(WEEKDAY_SUN0)
  .sort((a, b) => b.length - a.length)
  .join('|');

const EN_SMALL: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const CN_DIGIT: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const CN_WEEKDAY: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 0,
  天: 0,
};

/** Parse `YYYY-MM-DD` as a local calendar date (noon, to avoid DST edges). */
export function parseIsoDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    throw new InputError(`Invalid date "${value}". Expected YYYY-MM-DD.`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = makeDate(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new InputError(`Invalid date "${value}".`);
  }
  return date;
}

/** Format a Date as `YYYY-MM-DD` using the local calendar. */
export function formatIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function resolveReferenceDate(value: Date | string | undefined): Date {
  if (value === undefined) return startOfToday();
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new InputError('Invalid reference date.');
    return makeDate(value.getFullYear(), value.getMonth(), value.getDate());
  }
  return parseIsoDate(value);
}

/**
 * Find the first due phrase in `text`.
 * Weeks start on Monday. Relative phrases that land before the reference date
 * move forward so the deadline is not already past. An explicit year is kept.
 */
export function extractDue(text: string, referenceDate: Date | string): DueMatch | null {
  const ref = resolveReferenceDate(referenceDate);
  const normalized = normalizeWidth(text);
  const hits: Hit[] = [];
  collectAbsolute(normalized, ref, hits);
  collectEnglishRelative(normalized, ref, hits);
  collectChineseRelative(normalized, ref, hits);
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const best = hits[0];
  if (!best) return null;
  return { due: best.due, start: best.start, end: best.end };
}

function startOfToday(): Date {
  const now = new Date();
  return makeDate(now.getFullYear(), now.getMonth(), now.getDate());
}

function makeDate(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day, 12, 0, 0, 0);
}

function addDays(date: Date, days: number): Date {
  return makeDate(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function isBeforeDay(date: Date, ref: Date): boolean {
  return formatIso(date) < formatIso(ref);
}

/** Monday of the ISO-style week that contains `date`. */
function startOfWeek(date: Date): Date {
  const day = date.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  return addDays(date, delta);
}

function endOfMonth(date: Date, monthOffset: number): Date {
  return makeDate(date.getFullYear(), date.getMonth() + 1 + monthOffset, 0);
}

/**
 * Friday of the given week offset, or Sunday of that week when Friday is already past.
 * `weekOffset` 0 is the current week and 1 is next week.
 */
function businessWeekDeadline(ref: Date, weekOffset: number): Date {
  const monday = addDays(startOfWeek(ref), weekOffset * 7);
  const friday = addDays(monday, 4);
  const sunday = addDays(monday, 6);
  if (!isBeforeDay(friday, ref)) return friday;
  if (!isBeforeDay(sunday, ref)) return sunday;
  return addDays(friday, 7);
}

function sundayOfWeek(ref: Date, weekOffset: number): Date {
  const sunday = addDays(startOfWeek(ref), weekOffset * 7 + 6);
  return isBeforeDay(sunday, ref) ? addDays(sunday, 7) : sunday;
}

function weekdayOnOffset(ref: Date, sun0: number, weekOffset: number): Date {
  const monday = addDays(startOfWeek(ref), weekOffset * 7);
  const fromMonday = sun0 === 0 ? 6 : sun0 - 1;
  let date = addDays(monday, fromMonday);
  let guard = 0;
  while (isBeforeDay(date, ref) && guard < 3) {
    date = addDays(date, 7);
    guard += 1;
  }
  return date;
}

function upcomingWeekday(ref: Date, sun0: number): Date {
  const delta = (sun0 - ref.getDay() + 7) % 7;
  return addDays(ref, delta);
}

function withYearRolled(ref: Date, year: number | undefined, monthIndex: number, day: number): Date | null {
  const explicitYear = year !== undefined;
  let date = makeDate(explicitYear ? year : ref.getFullYear(), monthIndex, day);
  if (date.getMonth() !== monthIndex || date.getDate() !== day) return null;
  if (!explicitYear && isBeforeDay(date, ref)) {
    date = makeDate(ref.getFullYear() + 1, monthIndex, day);
    if (date.getMonth() !== monthIndex || date.getDate() !== day) return null;
  }
  return date;
}

function pushDate(
  hits: Hit[],
  start: number,
  end: number,
  date: Date | null,
  relative: boolean,
): void {
  if (!date || end - start < 2) return;
  hits.push({ due: formatIso(date), start, end, relative });
}

function normalizeWidth(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\u3000/g, ' ')
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

function parseCnNumber(raw: string): number | null {
  if (/^\d+$/.test(raw)) {
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }
  if (raw === '十') return 10;
  if (raw.startsWith('十') && raw.length === 2) {
    const ones = CN_DIGIT[raw[1] ?? ''];
    return ones === undefined ? null : 10 + ones;
  }
  const ten = raw.indexOf('十');
  if (ten >= 0) {
    const tens = CN_DIGIT[raw.slice(0, ten)] ?? (ten === 0 ? 1 : undefined);
    if (tens === undefined) return null;
    const rest = raw.slice(ten + 1);
    const ones = rest ? CN_DIGIT[rest] : 0;
    if (ones === undefined || rest.length > 1) return null;
    return tens * 10 + ones;
  }
  if (raw.length === 1) return CN_DIGIT[raw] ?? null;
  return null;
}

function parseEnCount(raw: string): number | null {
  if (/^\d+$/.test(raw)) return Number(raw);
  return EN_SMALL[raw.toLowerCase()] ?? null;
}

function collectAbsolute(text: string, ref: Date, hits: Hit[]): void {
  for (const match of text.matchAll(/\b(?:by\s+|before\s+|on\s+|due\s+)?(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = makeDate(year, month - 1, day);
    const index = match.index ?? 0;
    if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) {
      pushDate(hits, index, index + match[0].length, date, false);
    }
  }

  const cnDate =
    /(?:在|于)?(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)(?:之前|以前|前)?(?:完成|搞定)?/g;
  for (const match of text.matchAll(cnDate)) {
    const year = match[1] ? Number(match[1]) : undefined;
    const date = withYearRolled(ref, year, Number(match[2]) - 1, Number(match[3]));
    const index = match.index ?? 0;
    pushDate(hits, index, index + match[0].length, date, year === undefined);
  }

  const monthFirst = new RegExp(
    String.raw`\b(?:by\s+|before\s+|on\s+)?(${MONTH_PATTERN})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b`,
    'gi',
  );
  for (const match of text.matchAll(monthFirst)) {
    const monthName = match[1]?.toLowerCase();
    if (!monthName) continue;
    const month = MONTHS[monthName];
    if (month === undefined) continue;
    const year = match[3] ? Number(match[3]) : undefined;
    const date = withYearRolled(ref, year, month, Number(match[2]));
    const index = match.index ?? 0;
    pushDate(hits, index, index + match[0].length, date, year === undefined);
  }

  const dayFirst = new RegExp(
    String.raw`\b(?:by\s+|before\s+|on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(${MONTH_PATTERN})\.?(?:,?\s*(\d{4}))?\b`,
    'gi',
  );
  for (const match of text.matchAll(dayFirst)) {
    const monthName = match[2]?.toLowerCase();
    if (!monthName) continue;
    const month = MONTHS[monthName];
    if (month === undefined) continue;
    const year = match[3] ? Number(match[3]) : undefined;
    const date = withYearRolled(ref, year, month, Number(match[1]));
    const index = match.index ?? 0;
    pushDate(hits, index, index + match[0].length, date, year === undefined);
  }

  for (const match of text.matchAll(/\b(?:by\s+|before\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
    let month = Number(match[1]);
    let day = Number(match[2]);
    if (month > 12 && day <= 12) {
      const swap = month;
      month = day;
      day = swap;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    let year = match[3] ? Number(match[3]) : undefined;
    if (year !== undefined && year < 100) year += 2000;
    const date = withYearRolled(ref, year, month - 1, day);
    const index = match.index ?? 0;
    pushDate(hits, index, index + match[0].length, date, year === undefined);
  }
}

function collectEnglishRelative(text: string, ref: Date, hits: Hit[]): void {
  const dayWords = /\b(?:by\s+|before\s+)?(today|tonight|tomorrow|day after tomorrow|eod)\b/gi;
  for (const match of text.matchAll(dayWords)) {
    const word = match[1]?.toLowerCase();
    let date = ref;
    if (word === 'tomorrow') date = addDays(ref, 1);
    else if (word === 'day after tomorrow') date = addDays(ref, 2);
    const index = match.index ?? 0;
    pushDate(hits, index, index + match[0].length, date, true);
  }

  for (const match of text.matchAll(/\bASAP\b|\bas soon as possible\b/gi)) {
    const index = match.index ?? 0;
    pushDate(hits, index, index + match[0].length, ref, true);
  }

  const count = /\b(?:in|within)\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(day|days|week|weeks)\b/gi;
  for (const match of text.matchAll(count)) {
    const amount = parseEnCount(match[1] ?? '');
    const unit = match[2]?.toLowerCase() ?? '';
    if (amount === null || amount < 1 || amount > 366) continue;
    const days = unit.startsWith('week') ? amount * 7 : amount;
    const index = match.index ?? 0;
    pushDate(hits, index, index + match[0].length, addDays(ref, days), true);
  }

  const endOfWeek = /\b(?:by\s+|before\s+)?(?:the\s+)?end\s+of\s+(?:the\s+)?(next\s+|this\s+)?week\b|\b(?:by\s+|before\s+)?EOW\b/gi;
  for (const match of text.matchAll(endOfWeek)) {
    const offset = /next/i.test(match[1] ?? '') ? 1 : 0;
    const index = match.index ?? 0;
    pushDate(hits, index, index + match[0].length, businessWeekDeadline(ref, offset), true);
  }

  const weekWords = /\b(?:by\s+|before\s+)?(next|this)\s+week\b/gi;
  for (const match of text.matchAll(weekWords)) {
    const offset = match[1]?.toLowerCase() === 'next' ? 1 : 0;
    const index = match.index ?? 0;
    pushDate(hits, index, index + match[0].length, businessWeekDeadline(ref, offset), true);
  }

  const weekend = /\b(?:by\s+|before\s+)?(?:(this|next)\s+)?weekend\b/gi;
  for (const match of text.matchAll(weekend)) {
    const which = match[1]?.toLowerCase();
    const offset = which === 'next' ? 1 : 0;
    const date = which ? sundayOfWeek(ref, offset) : upcomingWeekday(ref, 0);
    const index = match.index ?? 0;
    pushDate(hits, index, index + match[0].length, date, true);
  }

  const endOfMonthPhrase = /\b(?:by\s+|before\s+)?(?:the\s+)?end\s+of\s+(?:the\s+)?(next\s+|this\s+)?month\b|\b(?:by\s+|before\s+)?EOM\b/gi;
  for (const match of text.matchAll(endOfMonthPhrase)) {
    const offset = /next/i.test(match[1] ?? '') ? 1 : 0;
    const index = match.index ?? 0;
    pushDate(hits, index, index + match[0].length, endOfMonth(ref, offset), true);
  }

  for (const match of text.matchAll(/\b(?:by\s+|before\s+)?next\s+month\b/gi)) {
    const index = match.index ?? 0;
    pushDate(hits, index, index + match[0].length, endOfMonth(ref, 1), true);
  }

  const weekday = new RegExp(
    String.raw`\b(?:by\s+|before\s+|due\s+(?:on\s+)?|on\s+)?(?:(this|next)\s+)?(${WEEKDAY_PATTERN})\b`,
    'gi',
  );
  for (const match of text.matchAll(weekday)) {
    const name = match[2]?.toLowerCase();
    if (!name) continue;
    const sun0 = WEEKDAY_SUN0[name];
    if (sun0 === undefined) continue;
    const mode = match[1]?.toLowerCase();
    const date =
      mode === 'next'
        ? weekdayOnOffset(ref, sun0, 1)
        : mode === 'this'
          ? weekdayOnOffset(ref, sun0, 0)
          : upcomingWeekday(ref, sun0);
    const index = match.index ?? 0;
    pushDate(hits, index, index + match[0].length, date, true);
  }
}

function collectChineseRelative(text: string, ref: Date, hits: Hit[]): void {
  const dayWord =
    /(?:在|于)?(大后天|后天|今天|今晚|今日|明天|明日)(?:上午|中午|下午|晚上|晚间|傍晚)?(?:之前|以前|前|之内|以内|内)?(?:完成|搞定)?/g;
  for (const match of text.matchAll(dayWord)) {
    const word = match[1] ?? '';
    let date = ref;
    if (word === '明天' || word === '明日') date = addDays(ref, 1);
    else if (word === '后天') date = addDays(ref, 2);
    else if (word === '大后天') date = addDays(ref, 3);
    const index = match.index ?? 0;
    pushDate(hits, index, index + match[0].length, date, true);
  }

  for (const match of text.matchAll(/尽快|尽早|越快越好/g)) {
    const index = match.index ?? 0;
    pushDate(hits, index, index + match[0].length, ref, true);
  }

  const inDays =
    /(?:在|于)?(\d{1,3}|[零一二两三四五六七八九十]{1,3})天(?:之)?(?:内|之内|后|以后|之后)(?:完成|搞定)?/g;
  for (const match of text.matchAll(inDays)) {
    const amount = parseCnNumber(match[1] ?? '');
    if (amount === null || amount < 1 || amount > 366) continue;
    const index = match.index ?? 0;
    pushDate(hits, index, index + match[0].length, addDays(ref, amount), true);
  }

  const inWeeks =
    /(?:在|于)?(\d{1,2}|[零一二两三四五六七八九十]{1,3})个?(?:周|星期)(?:之)?(?:内|之内|后|以后|之后)(?:完成|搞定)?/g;
  for (const match of text.matchAll(inWeeks)) {
    const amount = parseCnNumber(match[1] ?? '');
    if (amount === null || amount < 1 || amount > 52) continue;
    const index = match.index ?? 0;
    pushDate(hits, index, index + match[0].length, addDays(ref, amount * 7), true);
  }

  // "Before next week" is the Sunday that ends the current week, not next Friday.
  const beforeNextWeek = /(?:在|于)?(?:下个星期|下星期|下个周|下周)(?:之前|以前|前)/g;
  for (const match of text.matchAll(beforeNextWeek)) {
    const index = match.index ?? 0;
    // Reject 下周五前: a weekday character sits between 周 and 前.
    const body = match[0];
    if (/周[一二三四五六日天]/.test(body) || /星期[一二三四五六日天]/.test(body)) continue;
    pushDate(hits, index, index + body.length, sundayOfWeek(ref, 0), true);
  }

  const weekend = /(?:在|于)?(下下|下个|下|本|这|这个)?(?:周|星期)末(?:之前|以前|前)?/g;
  for (const match of text.matchAll(weekend)) {
    const mod = match[1] ?? '';
    const offset = mod.startsWith('下下') ? 2 : mod.startsWith('下') ? 1 : mod ? 0 : -1;
    const date = offset < 0 ? upcomingWeekday(ref, 0) : sundayOfWeek(ref, offset);
    const index = match.index ?? 0;
    pushDate(hits, index, index + match[0].length, date, true);
  }

  const thisOrNextWeek =
    /(?:在|于)?(本周|这周|这个周|本星期|这星期|这个星期|下周|下星期|下个周|下个星期)(?:之内|以内|内|之前|以前|前)?(?![一二三四五六日天])/g;
  for (const match of text.matchAll(thisOrNextWeek)) {
    const word = match[1] ?? '';
    // 下周前 is handled above as "before next week" (Sunday), not as next Friday.
    if (/^下/.test(word) && /(?:之前|以前|前)$/.test(match[0])) continue;
    const offset = word.startsWith('下') ? 1 : 0;
    const index = match.index ?? 0;
    pushDate(hits, index, index + match[0].length, businessWeekDeadline(ref, offset), true);
  }

  const monthEnd = /(?:在|于)?(下个月底|下月底|本月底|这个月底|这月底|月底|月末)(?:之前|以前|前)?/g;
  for (const match of text.matchAll(monthEnd)) {
    const word = match[1] ?? '';
    const offset = word.startsWith('下') ? 1 : 0;
    const index = match.index ?? 0;
    pushDate(hits, index, index + match[0].length, endOfMonth(ref, offset), true);
  }

  const weekday =
    /(?:在|于)?(下下个|下下|下个|下|本|这|这个)?(周|星期)([一二三四五六日天])(?:之前|以前|前|之内|以内|内)?/g;
  for (const match of text.matchAll(weekday)) {
    const sun0 = CN_WEEKDAY[match[3] ?? ''];
    if (sun0 === undefined) continue;
    const mod = match[1] ?? '';
    let date: Date;
    if (mod === '' ) date = upcomingWeekday(ref, sun0);
    else if (mod === '本' || mod === '这' || mod === '这个') date = weekdayOnOffset(ref, sun0, 0);
    else if (mod === '下' || mod === '下个') date = weekdayOnOffset(ref, sun0, 1);
    else date = weekdayOnOffset(ref, sun0, 2);
    const index = match.index ?? 0;
    pushDate(hits, index, index + match[0].length, date, true);
  }
}
