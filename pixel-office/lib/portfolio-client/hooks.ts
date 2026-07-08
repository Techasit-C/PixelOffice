"use client";

// Small custom data-fetching layer over the existing fetch pattern.
//
// Why not TanStack Query: the app already fetches with raw fetch + useEffect
// polling (see PixelOfficePageClient), TanStack Query is NOT installed, and this
// module's needs are modest (load-on-mount, manual refetch, abort on unmount).
// Adding a ~12KB gz dependency for that isn't justified, so this stays dependency
// free and consistent with the codebase.
import { useCallback, useEffect, useRef, useState } from "react";
import { portfolioApi } from "./api";
import type {
  PortfolioListResponse,
  ValuationEnvelope,
  AllocationEnvelope,
  MilestonesEnvelope,
  PerformanceEnvelope,
} from "./types";

export interface AsyncState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  refetch: () => void;
}

export function useAsyncData<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: ReadonlyArray<unknown>,
  enabled = true,
): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(enabled);
  const [tick, setTick] = useState(0);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    let active = true;
    setLoading(true);
    setError(undefined);

    fetcherRef.current(ctrl.signal).then(
      (d) => {
        if (!active) return;
        setData(d);
        setLoading(false);
      },
      (e: unknown) => {
        if (!active || ctrl.signal.aborted) return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setLoading(false);
      },
    );

    return () => {
      active = false;
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, enabled]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, refetch };
}

export function usePortfolios(): AsyncState<PortfolioListResponse> {
  return useAsyncData((signal) => portfolioApi.list(signal), []);
}

export function useValuation(id: string | undefined): AsyncState<ValuationEnvelope> {
  return useAsyncData(
    (signal) => portfolioApi.valuation(id as string, signal),
    [id],
    !!id,
  );
}

export function useAllocation(
  id: string | undefined,
  by: "asset" | "class" = "asset",
): AsyncState<AllocationEnvelope> {
  return useAsyncData(
    (signal) => portfolioApi.allocation(id as string, by, signal),
    [id, by],
    !!id,
  );
}

export function useMilestones(
  id: string | undefined,
): AsyncState<MilestonesEnvelope> {
  return useAsyncData(
    (signal) => portfolioApi.milestones(id as string, signal),
    [id],
    !!id,
  );
}

export function usePerformance(
  id: string | undefined,
): AsyncState<PerformanceEnvelope> {
  return useAsyncData(
    (signal) => portfolioApi.performance(id as string, signal),
    [id],
    !!id,
  );
}
