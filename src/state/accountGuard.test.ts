import { describe, expect, it, vi } from 'vitest';
import { createAccountGuard } from './accountGuard';

describe('createAccountGuard', () => {
  it('is active until revoked and carries user id and epoch', () => {
    const guard = createAccountGuard('user-1', 3);
    expect(guard.userId).toBe('user-1');
    expect(guard.epoch).toBe(3);
    expect(guard.active()).toBe(true);
    guard.revoke();
    expect(guard.active()).toBe(false);
  });

  it('calls revoke listeners exactly once, even if revoked twice', () => {
    const guard = createAccountGuard('user-1', 0);
    const listener = vi.fn();
    guard.onRevoke(listener);
    guard.revoke();
    guard.revoke();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('unsubscribed listeners are not called', () => {
    const guard = createAccountGuard('user-1', 0);
    const listener = vi.fn();
    const off = guard.onRevoke(listener);
    off();
    guard.revoke();
    expect(listener).not.toHaveBeenCalled();
  });

  it('a listener added after revoke runs immediately', () => {
    const guard = createAccountGuard('user-1', 0);
    guard.revoke();
    const listener = vi.fn();
    guard.onRevoke(listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('guards are independent per account session', () => {
    const a = createAccountGuard('user-a', 1);
    const b = createAccountGuard('user-b', 2);
    a.revoke();
    expect(b.active()).toBe(true);
  });
});
