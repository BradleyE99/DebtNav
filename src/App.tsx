/**
 * App shell (US-1201): signed out → public Overview + Google sign-in; sign-in not configured on the
 * server → setup screen (no fake login); signed in → the planner backed by the server store.
 */
import { useCallback, useMemo } from 'react';
import PlannerApp from './ui/PlannerApp';
import { AuthError, AuthNotConfigured, DevicePlanPrompt, PublicOverview, SignInButton, SignInNotice } from './ui/auth';
import type { AccountInfo } from './ui/auth';
import { api as defaultApi, type ApiClient, type ApiUser } from './state/api';
import { useSession } from './state/session';
import { clearCachedCopy, useServerPlanLoad, useServerPlannerDocument, type LoadedPlan } from './state/useServerPlannerDocument';
import { useDevicePlanOffer } from './state/devicePlan';

export default function App({ client = defaultApi }: { client?: ApiClient }) {
  const session = useSession(client);

  if (session.status === 'loading') return <p className="app-loading" role="status">Loading DebtNav…</p>;
  if (session.status === 'notConfigured') return <AuthNotConfigured />;
  if (session.status === 'error') return <AuthError message={session.error} onRetry={session.retry} />;
  if (session.status === 'signedOut' || !session.user) {
    return (
      <PublicOverview
        signIn={<SignInButton onSignIn={() => session.signIn('/')} />}
        notice={session.authNotice ? <SignInNotice kind={session.authNotice} onDismiss={session.dismissNotice} /> : undefined}
      />
    );
  }
  // Keyed by user: a different account never sees the previous user's store, history or cache.
  return <SignedInApp key={session.user.id} client={client} user={session.user} session={session} />;
}

type SessionApi = ReturnType<typeof useSession>;

function SignedInApp({ client, user, session }: { client: ApiClient; user: ApiUser; session: SessionApi }) {
  const onUnauthorized = useCallback(() => session.markSignedOut('expired'), [session]);
  const load = useServerPlanLoad({ api: client, userId: user.id, onUnauthorized });
  if (load.status === 'loading') return <p className="app-loading" role="status">Loading your plan…</p>;
  if (load.status === 'error') return <AuthError message={load.message} onRetry={load.retry} />;
  return <LoadedPlanner client={client} user={user} session={session} loaded={load.loaded} onUnauthorized={onUnauthorized} />;
}

function LoadedPlanner({ client, user, session, loaded, onUnauthorized }: {
  client: ApiClient; user: ApiUser; session: SessionApi; loaded: LoadedPlan; onUnauthorized(): void;
}) {
  const onAccountDeleted = useCallback(() => session.markSignedOut('deleted'), [session]);
  const { store, flush } = useServerPlannerDocument({ api: client, userId: user.id, onUnauthorized, onAccountDeleted }, loaded);
  const offer = useDevicePlanOffer(store, user.id);

  const account = useMemo<AccountInfo>(() => ({
    email: user.email,
    onSignOut: async () => {
      // Save pending edits first; signing out never deletes the saved plan.
      await flush();
      clearCachedCopy(user.id);
      await session.signOut();
    },
  }), [flush, session, user]);

  const devicePlanPrompt = offer.summary
    ? <DevicePlanPrompt summary={offer.summary} busy={offer.busy} error={offer.error} onUse={offer.use} onDismiss={offer.dismiss} />
    : offer.error ? <p role="status" className="device-plan-error">{offer.error}</p> : undefined;

  return <PlannerApp store={store} account={account} workbook={client} devicePlanPrompt={devicePlanPrompt} />;
}
