/**
 * NFR-5: plan data never leaves the device. The persistence and state layers must not use any
 * network API; they only touch the injected StorageLike / window.localStorage.
 */
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

const NETWORK = /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|RTCPeerConnection|importScripts|navigator\.serviceWorker|postMessage|indexedDB|document\.cookie)\b|https?:\/\//;

// Raw source text of every non-test module in src/data and src/state, loaded by Vite at test time.
const raw = {
  ...import.meta.glob<string>(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob<string>(['../state/**/*.{ts,tsx}', '!../state/**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true }),
};

describe('privacy (NFR-5)', () => {
  const files = Object.keys(raw);

  it('finds the data and state sources', () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it.each(files.map(file => [file]))('%s uses no network or other off-device API', file => {
    const text = raw[file];
    expect(text.match(NETWORK)?.[0] ?? null).toBeNull();
  });

  it('imports only engine, data and React modules', () => {
    for (const file of files) {
      const text = raw[file];
      for (const [, spec] of text.matchAll(/from '([^']+)'/g)) {
        expect(spec, `${file}: ${spec}`).toMatch(/^(react|\.\/|\.\.\/engine\/|\.\.\/data\/)/);
      }
    }
  });
});
