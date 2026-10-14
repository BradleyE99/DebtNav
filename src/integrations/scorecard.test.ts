import { describe, expect, it, vi } from 'vitest';
import {
  SCORECARD_LATEST_PROGRAM_YEAR,
  SCORECARD_SOURCE_URL,
  buildScorecardUrl,
  debtEarningsRatio,
  fetchScorecard,
  parseScorecard,
} from './scorecard';

const PERSONAL_KEY = 'a'.repeat(40);

/** Shape observed from the live API on 2026-10-13 (fields trimmed). */
const payload2022 = {
  metadata: { page: 0, total: 1, per_page: 10 },
  results: [{
    id: 186371,
    'school.name': 'Rutgers University-Camden',
    '2022.programs.cip_4_digit': [
      { title: 'Computer and Information Sciences, General.', credential: { title: "Bachelor's Degree" }, earnings: { '1_yr': { overall_median_earnings: 70000 }, '4_yr': { overall_median_earnings: 125303 }, '5_yr': { overall_median_earnings: null } } },
      { title: 'Suppressed Program.', credential: { title: "Bachelor's Degree" }, earnings: { '4_yr': { overall_median_earnings: null } } },
      { title: 'Nursing.', earnings: { '1_yr': { overall_median_earnings: 61000 } } },
    ],
  }],
};

/** The default request reads the `latest` release key. */
const latestPayload = { ...payload2022, results: [{ id: 186371, 'school.name': 'Rutgers University-Camden', 'latest.programs.cip_4_digit': payload2022.results[0]['2022.programs.cip_4_digit'] }] };
const payload = latestPayload;

function fetcherReturning(response: { ok: boolean; status: number; json?: () => Promise<unknown> }) {
  return vi.fn(async (_url: string, _init: RequestInit) => ({ json: async () => ({}), ...response }));
}

describe('parseScorecard', () => {
  it('keeps source, data year and credential, prefers the longest available period, skips suppressed data', () => {
    const records = parseScorecard(payload2022, '2022')!;
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({
      school: 'Rutgers University-Camden',
      program: 'Computer and Information Sciences, General',
      credential: "Bachelor's Degree",
      dataYear: '2022',
      medianEarnings: '125303.00',
      measurement: 'Median earnings 4 years after completing',
      source: 'U.S. Department of Education, College Scorecard',
      sourceUrl: SCORECARD_SOURCE_URL,
    });
    expect(records[1]).toMatchObject({ program: 'Nursing', credential: 'Credential not specified', measurement: 'Median earnings 1 year after completing' });
  });

  it('parses the latest-release key used by default', () => {
    const latest = { results: [{ 'school.name': 'X', 'latest.programs.cip_4_digit': payload2022.results[0]['2022.programs.cip_4_digit'] }] };
    expect(parseScorecard(latest, SCORECARD_LATEST_PROGRAM_YEAR)).toHaveLength(2);
    expect(buildScorecardUrl('X', 'latest', 'DEMO_KEY')).toContain('latest.programs.cip_4_digit.title');
  });

  it('returns null for unsupported payloads and never throws', () => {
    for (const value of [null, {}, { results: 'x' }, 'text', 42]) expect(parseScorecard(value, '2022')).toBeNull();
    expect(parseScorecard({ results: [null, 1, { '2022.programs.cip_4_digit': [null, { title: 3 }] }] }, '2022')).toEqual([]);
  });
});

describe('fetchScorecard', () => {
  it('sends only the school name, data year and public demo key, without credentials or referrer', async () => {
    const fetcher = fetcherReturning({ ok: true, status: 200, json: async () => payload });
    const result = await fetchScorecard({ school: '  Rutgers ', program: 'computer' }, fetcher);
    expect(result).toMatchObject({ ok: true, dataYear: SCORECARD_LATEST_PROGRAM_YEAR, usedDemoKey: true });
    if (result.ok) expect(result.records.map(record => record.program)).toEqual(['Computer and Information Sciences, General']);
    const [url, init] = fetcher.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://api.data.gov/ed/collegescorecard/v1/schools');
    expect([...parsed.searchParams.keys()].sort()).toEqual(['api_key', 'fields', 'per_page', 'school.name']);
    expect(parsed.searchParams.get('api_key')).toBe('DEMO_KEY');
    expect(parsed.searchParams.get('school.name')).toBe('Rutgers');
    expect(url).not.toMatch(/computer/i); // program filter stays on the device
    expect(parsed.searchParams.get('fields')).toContain('latest.programs.cip_4_digit.earnings.4_yr.overall_median_earnings');
    expect(init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
  });

  it('uses a pasted personal key when provided', async () => {
    const fetcher = fetcherReturning({ ok: true, status: 200, json: async () => payload });
    const result = await fetchScorecard({ school: 'Rutgers', apiKey: PERSONAL_KEY }, fetcher);
    expect(result).toMatchObject({ ok: true, usedDemoKey: false });
    expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('api_key')).toBe(PERSONAL_KEY);
  });

  it.each([
    [429, 'rate-limited', /hourly limit/],
    [403, 'key-rejected', /did not accept/],
    [500, 'unavailable', /HTTP 500/],
  ])('maps HTTP %i to a clear %s state', async (status, reason, message) => {
    const result = await fetchScorecard({ school: 'Rutgers' }, fetcherReturning({ ok: false, status }));
    expect(result).toMatchObject({ ok: false, reason });
    if (!result.ok) expect(result.message).toMatch(message);
  });

  it('reports network failures and unreadable responses', async () => {
    const offline = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    expect(await fetchScorecard({ school: 'Rutgers' }, offline)).toMatchObject({ ok: false, reason: 'network' });
    const garbage = fetcherReturning({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } });
    expect(await fetchScorecard({ school: 'Rutgers' }, garbage)).toMatchObject({ ok: false, reason: 'unsupported-response' });
  });

  it('rejects malformed input without any network access', async () => {
    const fetcher = vi.fn();
    for (const query of [{ school: '' }, { school: 'x'.repeat(151) }, { school: 'Rutgers', year: '22' }, { school: 'Rutgers', apiKey: 'short' }]) {
      expect(await fetchScorecard(query, fetcher)).toMatchObject({ ok: false, reason: 'invalid-input' });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('builds year-specific field names', () => {
    expect(buildScorecardUrl('X', '2021', 'DEMO_KEY')).toContain('2021.programs.cip_4_digit.title');
  });
});

describe('debtEarningsRatio', () => {
  it('computes on the device and handles bad inputs', () => {
    expect(debtEarningsRatio('30000', '60000')).toBe('0.50');
    expect(debtEarningsRatio('30000', '0')).toBeNull();
    expect(debtEarningsRatio('abc', '60000')).toBeNull();
  });
});
