'use client';
import { useEffect, useRef, useState } from 'react';

export type ProgressRead<T> = {
  data: T | null;
  failed: boolean;
  retry: () => void;
};
// Cancellation is checked even when a test transport/server ignores the signal.
export function startProgressRead<T>(
  load: (signal: AbortSignal) => Promise<T>,
  onData: (data: T) => void,
  onError: (error: unknown) => void,
): () => void {
  const controller = new AbortController();
  void load(controller.signal)
    .then((data) => {
      if (!controller.signal.aborted) onData(data);
    })
    .catch((error: unknown) => {
      if (!controller.signal.aborted) onError(error);
    });
  return () => controller.abort();
}
// A scoped GET resource, not a cache/query framework. Its identity gates both
// success and error, so a late response can never belong to another selection.
// The key must contain every GET parameter. Callback updates do not change the
// read identity (e.g. URL-only metric/label changes); install them before reads.
export function useProgressRead<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
  onError: (error: unknown) => void,
): ProgressRead<T> {
  const [attempt, setAttempt] = useState(0),
    [result, setResult] = useState<
      { key: string; data: T } | { key: string; failed: true } | null
    >(null);
  const identity = key === null ? null : JSON.stringify([key, attempt]);
  const callbacks = useRef({ load, onError });
  useEffect(() => {
    callbacks.current = { load, onError };
  }, [load, onError]);
  useEffect(() => {
    if (identity === null) return;
    return startProgressRead(
      callbacks.current.load,
      (data) => setResult({ key: identity, data }),
      (error) => {
        callbacks.current.onError(error);
        setResult({ key: identity, failed: true });
      },
    );
  }, [identity]);
  const current = result?.key === identity ? result : null;
  return {
    data: current && 'data' in current ? current.data : null,
    failed: current !== null && 'failed' in current,
    retry: () => setAttempt((value) => value + 1),
  };
}
