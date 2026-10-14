const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
let fallbackCounter = 0;

/** New opaque record id. Uses crypto.randomUUID when available, otherwise a safe fallback. */
export function newId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid && ID_PATTERN.test(uuid)) return uuid;
  fallbackCounter += 1;
  return `id-${Date.now().toString(36)}-${fallbackCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
