import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { PlannerPlan } from '../../engine/planner-contracts';
import { computeSecondary, type SecondaryRequest, type SecondaryResponse, type SecondaryResults } from './secondary';

interface Delivered { plan: PlannerPlan; result: SecondaryResults }

/**
 * Talks to the secondary-results worker. At most one request is in flight; while it runs, only the
 * newest plan is kept, and responses for superseded plans are discarded (never shown).
 */
class SecondaryClient {
  private seq = 0;
  private inFlight: { id: number; plan: PlannerPlan } | null = null;
  private queued: PlannerPlan | null = null;
  private readonly worker: Worker;

  constructor(private readonly onResult: (delivered: Delivered) => void, onFail: () => void) {
    this.worker = new Worker(new URL('./secondary.worker.ts', import.meta.url), { type: 'module', name: 'debtnav-secondary' });
    this.worker.onmessage = (event: MessageEvent<SecondaryResponse>) => this.receive(event.data);
    this.worker.onerror = event => { event.preventDefault(); this.dispose(); onFail(); };
  }

  request(plan: PlannerPlan) {
    if (this.inFlight) { this.queued = plan; return; }
    this.send(plan);
  }

  private send(plan: PlannerPlan) {
    this.seq += 1;
    this.inFlight = { id: this.seq, plan };
    this.worker.postMessage({ id: this.seq, plan } satisfies SecondaryRequest);
  }

  private receive(response: SecondaryResponse) {
    const current = this.inFlight;
    this.inFlight = null;
    if (!current || response.id !== current.id) return;
    const next = this.queued;
    this.queued = null;
    if (next && next !== current.plan) { this.send(next); return; } // stale: discard and compute the newest plan
    this.onResult({ plan: current.plan, result: response.result });
  }

  dispose() { this.worker.terminate(); this.inFlight = null; this.queued = null; }
}

const workerSupported = () => typeof Worker !== 'undefined';

/**
 * Secondary results for `plan`, computed in a Web Worker when available. `updating` is true while
 * the shown results belong to an older plan (or none have arrived yet).
 */
export function useSecondaryResults(plan: PlannerPlan): { results: SecondaryResults | null; updating: boolean } {
  const [useWorker, setUseWorker] = useState(workerSupported);
  const [delivered, setDelivered] = useState<Delivered | null>(null);
  const client = useRef<SecondaryClient | null>(null);

  useEffect(() => {
    if (!useWorker) return;
    try {
      client.current = new SecondaryClient(setDelivered, () => { client.current = null; setUseWorker(false); });
    } catch {
      // Worker construction failed (blocked or unsupported): fall back to main-thread computation.
      queueMicrotask(() => setUseWorker(false));
      return;
    }
    return () => { client.current?.dispose(); client.current = null; };
  }, [useWorker]);

  useEffect(() => { client.current?.request(plan); }, [plan, useWorker]);

  // Fallback without a worker: compute from a deferred plan value (jsdom tests, very old browsers).
  const deferredPlan = useDeferredValue(plan);
  const syncResults = useMemo(() => (useWorker ? null : computeSecondary(deferredPlan)), [useWorker, deferredPlan]);

  if (!useWorker) return { results: syncResults, updating: deferredPlan !== plan };
  return { results: delivered?.result ?? null, updating: delivered?.plan !== plan };
}
