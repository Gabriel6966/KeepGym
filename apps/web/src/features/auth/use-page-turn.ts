'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createPageTurn } from './auth-transitions';

export function usePageTurn(href: string) {
  const router = useRouter();
  const [turningHref, setTurningHref] = useState<string | null>(null);
  const turn = useRef<ReturnType<typeof createPageTurn> | null>(null);
  useEffect(
    () => () => {
      turn.current?.dispose();
      turn.current = null;
    },
    [href, router],
  );
  function begin(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    if (!turn.current)
      turn.current = createPageTurn(
        () => router.push(href),
        (finish, ms) => {
          const timer = setTimeout(finish, ms);
          return () => clearTimeout(timer);
        },
      );
    if (
      turn.current.start(
        window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      )
    )
      setTurningHref(href);
  }
  return {
    turning: turningHref === href,
    begin,
    finish: () => turn.current?.finish(),
  };
}
