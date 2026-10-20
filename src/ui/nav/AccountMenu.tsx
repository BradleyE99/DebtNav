import { useEffect, useId, useRef, useState } from 'react';
import { ShellIcon } from './icons';

export interface AccountMenuProps {
  /** Signed-in email; omitted for the local store (tests, dev fallback). */
  email?: string | null;
  signedIn: boolean;
  onOpenData(): void;
  onOpenHistory(): void;
  onOpenDisclaimer(): void;
  onSignOut?(): void;
  /** Guest mode: "Sign in with Google" item. Omitted when signed in (or for tests without auth). */
  onSignIn?(): void;
  /** Guest mode: sign-in can't be used right now; the item is disabled and this explains why. */
  signInUnavailableText?: string;
}

/**
 * Header account menu: a disclosure button and a short list of actions (not an ARIA menu, so Tab and
 * Enter work as usual). Escape or a click outside closes it; choosing an action closes it first.
 */
export function AccountMenu({ email, signedIn, onOpenData, onOpenHistory, onOpenDisclaimer, onSignOut, onSignIn, signInUnavailableText }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent | MouseEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (action: () => void) => () => { setOpen(false); buttonRef.current?.focus(); action(); };

  return (
    <div className="account-menu" ref={rootRef}>
      <button type="button" ref={buttonRef} className="account-menu__button" aria-expanded={open} aria-controls={listId}
        onClick={() => setOpen(value => !value)}>
        <ShellIcon name="account" size={18} />
        <span className="account-menu__label">Account<span className="visually-hidden"> menu</span></span>
        <ShellIcon name="chevron" size={16} />
      </button>
      <div id={listId} className="account-menu__panel" hidden={!open}>
        {signedIn ? (
          <p className="account-menu__email" title={email ?? undefined}>
            <span className="visually-hidden">Signed in as </span>{email ?? 'Signed in'}
          </p>
        ) : onSignIn ? (
          <p className="account-menu__email">Not signed in (guest)</p>
        ) : null}
        <ul>
          <li><button type="button" onClick={choose(onOpenData)}>Your data</button></li>
          <li><button type="button" onClick={choose(onOpenHistory)}>Undo history</button></li>
          <li><button type="button" onClick={choose(onOpenDisclaimer)}>About these estimates</button></li>
          {!signedIn && onSignIn && (
            <li>
              <button type="button" onClick={choose(onSignIn)} disabled={Boolean(signInUnavailableText)}
                aria-describedby={`${listId}-signin`}>Sign in with Google</button>
              <span id={`${listId}-signin`} className={signInUnavailableText ? 'account-menu__hint' : 'visually-hidden'}>
                {signInUnavailableText ?? 'Save your plan to your account and use it on other devices.'}
              </span>
            </li>
          )}
          {signedIn && onSignOut && (
            <li>
              <button type="button" onClick={choose(onSignOut)} aria-describedby={`${listId}-signout`}>Sign out</button>
              <span id={`${listId}-signout`} className="visually-hidden">Your saved plan stays on your account.</span>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
