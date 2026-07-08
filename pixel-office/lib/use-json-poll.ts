"use client";

// Tiny polling hook for the new dashboard views. Mirrors the office's
// fetch + setInterval + cancel-on-unmount pattern (see PixelOfficePageClient),
// but generalised so the executive/operations/mission-control pages can each
// poll several endpoints without repeating the boilerplate.
//
// Honest states: `data` stays at its last good value across a transient poll
// failure, while `error` reflects the most recent attempt and `loading` is only
// true until the first settle.
import { useEffect, useRef, useState } from "react";

export interface PollState<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
  refetch: () => void;
}

export function useJsonPoll<T>(url: string, intervalMs: number): PollState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const firstRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();

    async function poll() {
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as T;
        if (cancelled) return;
        setData(json);
        setError(undefined);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (firstRef.current) {
      firstRef.current = false;
    } else {
      // manual refetch / url change resets the loading gate
      setLoading(true);
    }
    poll();
    const id = setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      ctrl.abort();
      clearInterval(id);
    };
  }, [url, intervalMs, tick]);

  return { data, error, loading, refetch: () => setTick((t) => t + 1) };
}
