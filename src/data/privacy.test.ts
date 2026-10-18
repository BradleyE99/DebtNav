/**
 * NFR-5 (v0.2): financial inputs go only to DebtNav's own authorized backend. In the data and state layers,
 * only the API client (src/state/api.ts) may use the network, and only through same-origin relative `/api/`
 * paths; no other network API and no absolute (third-party) URL appears anywhere.
 */
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

const NETWORK = /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|RTCPeerConnection|importScripts|navigator\.serviceWorker|postMessage|indexedDB|document\.cookie)\b/;
const ABSOLUTE_URL = /https?:\/\//;
const API_CLIENT = '../state/api.ts';

// Raw source text of every non-test module in src/data and src/state, loaded by Vite at test time.
const raw = {
  ...import.meta.glob<string>(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob<string>(['../state/**/*.{ts,tsx}', '!../state/**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true }),
};
/** Source without comments, so documentation that mentions fetch is not mistaken for a call. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('privacy (NFR-5)', () => {
  const files = Object.keys(raw);

  it('finds the data and state sources, including the API client', () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
    expect(files).toContain(API_CLIENT);
  });

  it.each(files.filter(file => file !== API_CLIENT).map(file => [file]))('%s uses no network or other off-device API', file => {
    expect(code(raw[file]).match(NETWORK)?.[0] ?? null).toBeNull();
  });

  it.each(files.map(file => [file]))('%s contains no absolute URL', file => {
    expect(code(raw[file]).match(ABSOLUTE_URL)?.[0] ?? null).toBeNull();
  });

  it('the API client only calls same-origin /api/ paths with same-origin credentials', () => {
    const text = code(raw[API_CLIENT]);
    expect(text).toContain("credentials: 'same-origin'");
    // Every request goes through request(path) with a literal path; the base defaults to '' (same origin).
    expect(text).toContain("options.base ?? ''");
    const paths = [...text.matchAll(/\brequest\(\s*[`'"]([^`'"]*)/g)].map(match => match[1]);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) expect(path).toMatch(/^\/api\//);
    expect([...text.matchAll(/\bdoFetch\(/g)]).toHaveLength(1);
  });

  it('imports only engine, data, state and React modules (type-only UI contracts allowed)', () => {
    for (const file of files) {
      for (const match of raw[file].matchAll(/^import (type )?[^;]*? from '([^']+)'/gm)) {
        const [, typeOnly, spec] = match;
        if (typeOnly && spec.startsWith('../ui/')) continue;
        expect(spec, `${file}: ${spec}`).toMatch(/^(react|\.\/|\.\.\/engine\/|\.\.\/data\/|\.\.\/state\/)/);
      }
    }
  });
});
