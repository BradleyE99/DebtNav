/** Module worker: computes secondary results off the main thread so typing stays responsive (US-701). */
import { computeSecondary, type SecondaryRequest, type SecondaryResponse } from './secondary';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SecondaryRequest>) => void) | null;
  postMessage(message: SecondaryResponse): void;
};

scope.onmessage = event => {
  const { id, plan } = event.data;
  scope.postMessage({ id, result: computeSecondary(plan) });
};
