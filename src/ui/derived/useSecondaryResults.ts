import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { ISODate, PlannerPlan } from '../../engine/planner-contracts';
import { computeSecondary, type SecondaryRequest, type SecondaryResponse, type SecondaryResults } from './secondary';

interface Delivered { plan: PlannerPlan; today: ISODate; result: SecondaryResults }
interface Job { plan: PlannerPlan; today: ISODate }

/**
 * Talks to the secondary-results worker. At most one request is in flight; while it runs, only the
 * newest plan is kept, and responses for superseded plans are discarded (never shown).
 */
class SecondaryClient {
  private seq = 0;
  private inFlight: ({ id: number } & Job) | null = null;
  private queued: Job | null = null;
  private readonly worker: Worker;

  constructor(private readonly onResult: (delivered: Delivered) => void, onFail: () => void) {
    this.worker = new Worker(new URL('./secondary.worker.ts', import.meta.url), { type: 'module', name: 'debtnav-secondary' });
    this.worker.onmessage = (event: MessageEvent<SecondaryResponse>) => this.receive(event.data);
    this.worker.onerror = event => { event.preventDefault(); this.dispose(); onFail(); };
  }

  request(job: Job) {
    if (this.inFlight) { this.queued = job; return; }
    this.send(job);
  }

  private send(job: Job) {
    this.seq += 1;
    this.inFlight = { id: this.seq, ...job };
    this.worker.postMessage({ id: this.seq, plan: job.plan, today: job.today } satisfies SecondaryRequest);
  }

  private receive(response: SecondaryResponse) {
    const current = this.inFlight;
    this.inFlight = null;
    if (!current || response.id !== current.id) return;
    const next = this.queued;
    this.queued = null;
    // Stale: discard and compute the newest plan.
    if (next && (next.plan !== current.plan || next.today !== current.today)) { this.send(next); return; }
    this.onResult({ plan: current.plan, today: current.today, result: response.result });
  }

  dispose() { this.worker.terminate(); this.inFlight = null; this.queued = null; }
}

const workerSupported = () => typeof Worker !== 'undefined';

/**
 * Secondary results for `plan` (comparisons and the US-506 target solver), computed in a Web Worker when
 * available. `today` (UTC 'YYYY-MM-DD', supplied by the caller) decides whether a target date has passed.
 * `updating` is true while the shown results belong to an older plan (or none have arrived yet).
 */
export function useSecondaryResults(plan: PlannerPlan, today: ISODate): { results: SecondaryResults | null; updating: boolean } {
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

  useEffect(() => { client.current?.request({ plan, today }); }, [plan, today, useWorker]);

  // Fallback without a worker: compute from a deferred plan value (jsdom tests, very old browsers).
  const deferredPlan = useDeferredValue(plan);
  const syncResults = useMemo(() => (useWorker ? null : computeSecondary(deferredPlan, today)), [useWorker, deferredPlan, today]);

  if (!useWorker) return { results: syncResults, updating: deferredPlan !== plan };
  return { results: delivered?.result ?? null, updating: delivered?.plan !== plan || delivered?.today !== today };
}
