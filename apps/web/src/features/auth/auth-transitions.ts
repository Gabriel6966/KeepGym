export type AuthEntryView = 'entry' | 'opening' | 'login' | 'closing';
export function authEntryTransition(
  view: AuthEntryView,
  event: 'open' | 'revealed' | 'back' | 'closed',
): AuthEntryView {
  if (event === 'back' && view === 'login') return 'closing';
  if (event === 'closed' && view === 'closing') return 'entry';
  if (event === 'open' && view === 'entry') return 'opening';
  if (event === 'revealed' && view === 'opening') return 'login';
  return view;
}

export const entryRevealMs = 640;
export const pageTurnMs = 640;

export type EntrySide = 'about' | 'access' | null;
export function entryInteractionTransition(
  state: EntrySide,
  event:
    | { type: 'pointer'; side: Exclude<EntrySide, null>; hoverCapable: boolean }
    | { type: 'focus'; side: Exclude<EntrySide, null> }
    | { type: 'leave' },
): EntrySide {
  if (event.type === 'leave') return null;
  if (event.type === 'pointer') return event.hoverCapable ? event.side : state;
  return event.side;
}

// Both animationend and the fallback may finish a turn. Only one navigation is
// allowed, and disposing a route cancels its pending work.
export function createPageTurn(
  navigate: () => void,
  schedule: (finish: () => void, ms: number) => () => void,
) {
  let state: 'idle' | 'turning' | 'finished' | 'disposed' = 'idle';
  let cancel: (() => void) | undefined;
  function finish() {
    if (state !== 'turning') return;
    state = 'finished';
    cancel?.();
    navigate();
  }
  return {
    start(reducedMotion: boolean) {
      if (state !== 'idle') return false;
      state = 'turning';
      if (reducedMotion) finish();
      else cancel = schedule(finish, pageTurnMs);
      return true;
    },
    finish,
    dispose() {
      state = 'disposed';
      cancel?.();
    },
  };
}
