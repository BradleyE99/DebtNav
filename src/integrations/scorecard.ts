/**
 * College Scorecard lookup (US-1101): program-level median earnings for a school.
 *
 * Privacy (NFR-5): the only data that leaves the device is the school name and the data year (plus
 * the public DEMO_KEY or a key the user pasted for this session). The program filter is applied on
 * the device, and debt, income and every other plan value stay local. Requests omit credentials and
 * the referrer.
 *
 * Verified 2026-10-13 against the live API and https://collegescorecard.ed.gov/data/api-documentation/:
 * - Every request needs an api.data.gov key (no key → HTTP 403 API_KEY_MISSING).
 * - The endpoint sends `Access-Control-Allow-Origin: *`, so a browser can call it directly.
 * - DEMO_KEY is shared and heavily limited (the response advertised X-Ratelimit-Limit: 10 per IP;
 *   api.data.gov documents 30/hour and 50/day). A personal free key allows 1,000 requests/hour.
 * - Program data lives under `<year>.programs.cip_4_digit[]` with `title`, `credential.title` and
 *   `earnings.{1_yr,4_yr,5_yr}.overall_median_earnings`.
 * - Re-checked 2026-10-13 (live, Purdue id 243780, 349 programs): the `latest` key carries 1-, 4- and
 *   5-year program earnings, while `2022` carries only 4-year earnings and `2023`/`2024` carry no
 *   program data. The API docs note "latest" values may come from different release years, so
 *   figures from `latest` are labeled "latest release" rather than a single year.
 */
import { D } from '../engine/money';

export const SCORECARD_ENDPOINT = 'https://api.data.gov/ed/collegescorecard/v1/schools';
export const SCORECARD_SOURCE_NAME = 'U.S. Department of Education, College Scorecard';
export const SCORECARD_SOURCE_URL = 'https://collegescorecard.ed.gov/data/';
/** Default Scorecard data key: the most recent release of every field (checked 2026-10-13). */
export const SCORECARD_LATEST = 'latest';
/** @deprecated kept for callers; the default is now the `latest` release key. */
export const SCORECARD_LATEST_PROGRAM_YEAR = SCORECARD_LATEST;
/** Human label for a data key, shown next to every figure. */
export const scorecardYearLabel = (year: string): string => (year === SCORECARD_LATEST ? 'latest release (measures may come from different years)' : year);
export const SCORECARD_DEMO_KEY = 'DEMO_KEY';
const REQUEST_TIMEOUT_MS = 15_000;
const PERIODS = [
  { key: '5_yr', label: '5 years after completing' },
  { key: '4_yr', label: '4 years after completing' },
  { key: '1_yr', label: '1 year after completing' },
] as const;

export interface EarningsRecord {
  school: string;
  program: string;
  credential: string;
  /** Scorecard data key the figure comes from ('latest' or a year); show scorecardYearLabel(dataYear) next to it. */
  dataYear: string;
  /** Median annual earnings in dollars (decimal text). */
  medianEarnings: string;
  /** e.g. 'Median earnings 4 years after completing'. */
  measurement: string;
  source: string;
  sourceUrl: string;
}

export type ScorecardFailure =
  | 'invalid-input' // nothing was sent
  | 'rate-limited'
  | 'key-rejected'
  | 'unavailable'
  | 'network'
  | 'unsupported-response';

export type ScorecardResult =
  | { ok: true; records: EarningsRecord[]; dataYear: string; usedDemoKey: boolean }
  | { ok: false; reason: ScorecardFailure; message: string };

export interface ScorecardQuery {
  school: string;
  /** Filtered on the device; never sent. */
  program?: string;
  year?: string;
  /** Optional personal api.data.gov key. Keep it in memory only; never persist or log it. */
  apiKey?: string;
}

type Fetcher = (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

/** api.data.gov keys are 40 alphanumeric characters. */
export const isPlausibleApiKey = (key: string): boolean => /^[A-Za-z0-9]{40}$/.test(key.trim());

export function buildScorecardUrl(school: string, year: string, apiKey: string): string {
  const base = `${year}.programs.cip_4_digit`;
  const fields = [
    'id',
    'school.name',
    `${base}.title`,
    `${base}.credential.title`,
    ...PERIODS.map(period => `${base}.earnings.${period.key}.overall_median_earnings`),
  ];
  const query = new URLSearchParams({ api_key: apiKey, 'school.name': school, fields: fields.join(','), per_page: '10' });
  return `${SCORECARD_ENDPOINT}?${query}`;
}

const failure = (reason: ScorecardFailure, message: string): ScorecardResult => ({ ok: false, reason, message });

export async function fetchScorecard(query: ScorecardQuery, fetcher: Fetcher = (url, init) => fetch(url, init)): Promise<ScorecardResult> {
  const school = typeof query.school === 'string' ? query.school.trim() : '';
  const year = query.year ?? SCORECARD_LATEST_PROGRAM_YEAR;
  if (!school || school.length > 150) return failure('invalid-input', 'Enter a school name (up to 150 characters).');
  if (year !== SCORECARD_LATEST && !/^20\d{2}$/.test(year)) return failure('invalid-input', 'Enter a four-digit data year, or "latest".');
  const personalKey = query.apiKey?.trim();
  if (personalKey && !isPlausibleApiKey(personalKey)) return failure('invalid-input', 'An api.data.gov key is 40 letters and digits. Check the key or leave it blank to use the public demo key.');
  const usedDemoKey = !personalKey;

  let response: Awaited<ReturnType<Fetcher>>;
  try {
    const init: RequestInit = { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' };
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') init.signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    response = await fetcher(buildScorecardUrl(school, year, personalKey || SCORECARD_DEMO_KEY), init);
  } catch {
    return failure('network', 'College Scorecard could not be reached. Check your connection and try again. No plan data was sent.');
  }

  if (!response.ok) {
    if (response.status === 429) {
      return failure('rate-limited', usedDemoKey
        ? 'The shared public demo key has reached its hourly limit. Try again later, or paste your own free api.data.gov key for this session.'
        : 'Your api.data.gov key has reached its rate limit. Try again later.');
    }
    if (response.status === 401 || response.status === 403) {
      return failure('key-rejected', usedDemoKey
        ? 'College Scorecard did not accept the public demo key. Paste your own free api.data.gov key to continue.'
        : 'College Scorecard did not accept that api.data.gov key. Check it and try again.');
    }
    return failure('unavailable', `College Scorecard is unavailable right now (HTTP ${response.status}). No plan data was sent.`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return failure('unsupported-response', 'College Scorecard returned a response DebtNav cannot read.');
  }
  const records = parseScorecard(payload, year);
  if (records === null) return failure('unsupported-response', 'College Scorecard returned a response DebtNav cannot read.');
  return { ok: true, records: filterByProgram(records, query.program), dataYear: year, usedDemoKey };
}

export function filterByProgram(records: EarningsRecord[], program?: string): EarningsRecord[] {
  const words = (program ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return records;
  return records.filter(record => words.every(word => record.program.toLowerCase().includes(word)));
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Returns null for an unrecognized payload. Suppressed (null) earnings are skipped, never invented. */
export function parseScorecard(payload: unknown, year: string): EarningsRecord[] | null {
  if (!isObject(payload) || !Array.isArray(payload.results)) return null;
  const records: EarningsRecord[] = [];
  for (const row of payload.results) {
    if (!isObject(row)) continue;
    const programs = row[`${year}.programs.cip_4_digit`];
    if (!Array.isArray(programs)) continue;
    for (const program of programs) {
      if (!isObject(program) || typeof program.title !== 'string') continue;
      const nestedSchool = isObject(program.school) ? program.school.name : undefined;
      const school = typeof row['school.name'] === 'string' ? row['school.name'] : typeof nestedSchool === 'string' ? nestedSchool : 'School name not provided';
      const credential = isObject(program.credential) && typeof program.credential.title === 'string' ? program.credential.title : 'Credential not specified';
      const earnings = isObject(program.earnings) ? program.earnings : {};
      for (const period of PERIODS) {
        const bucket = earnings[period.key];
        const value = isObject(bucket) ? bucket.overall_median_earnings : undefined;
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 10_000_000) continue;
        records.push({
          school,
          program: program.title.replace(/\.$/, ''),
          credential,
          dataYear: year,
          medianEarnings: new D(value).toFixed(2),
          measurement: `Median earnings ${period.label}`,
          source: SCORECARD_SOURCE_NAME,
          sourceUrl: SCORECARD_SOURCE_URL,
        });
        break;
      }
    }
  }
  return records;
}

/** Debt ÷ annual earnings, computed on the device. Null when earnings are not positive or inputs are invalid. */
export function debtEarningsRatio(debt: string, earnings: string): string | null {
  try {
    const annual = new D(earnings);
    const owed = new D(debt);
    if (!annual.isFinite() || !owed.isFinite() || annual.lte(0) || owed.lt(0)) return null;
    return owed.div(annual).toFixed(2);
  } catch {
    return null;
  }
}
