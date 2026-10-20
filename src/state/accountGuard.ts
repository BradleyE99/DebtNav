/**
 * One guard per mounted account session (user id + session epoch). Async work that finishes after
 * sign-out or an account switch checks active() and drops its result, so it can never write caches,
 * change status or show another account's data.
 */
export interface AccountGuard {
  readonly userId: string;
  readonly epoch: number;
  active(): boolean;
  revoke(): void;
  onRevoke(fn: () => void): () => void;
}

export function createAccountGuard(userId: string, epoch: number): AccountGuard {
  let live = true;
  const listeners = new Set<() => void>();
  return {
    userId,
    epoch,
    active: () => live,
    revoke() {
      if (!live) return;
      live = false;
      for (const fn of [...listeners]) fn();
      listeners.clear();
    },
    onRevoke(fn) {
      if (!live) {
        fn();
        return () => {};
      }
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}
