"use client";

import { useCallback, useEffect, useState } from "react";

export interface WindowLayout {
  x: number;
  y: number;
  minimized: boolean;
  closed: boolean;
}

export type LayoutMap = Record<string, WindowLayout>;

const STORAGE_KEY = "pixel-dashboard-layout-v1";

function loadStoredLayout(): LayoutMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LayoutMap) : {};
  } catch {
    return {};
  }
}

function saveStoredLayout(layout: LayoutMap) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // ignore quota / private-mode errors
  }
}

export function useWindowManager(defaults: LayoutMap) {
  // Start from `defaults` (deterministic, matches SSR output) and only apply
  // localStorage after mount — reading localStorage during the initial
  // render would make the client's first paint diverge from the server-
  // rendered HTML (localStorage doesn't exist on the server) and trigger a
  // hydration mismatch.
  const [layout, setLayout] = useState<LayoutMap>(defaults);
  const [order, setOrder] = useState<string[]>(Object.keys(defaults));

  useEffect(() => {
    const stored = loadStoredLayout();
    if (Object.keys(stored).length === 0) return;
    // Intentional post-mount hydration from localStorage, see comment above.
    setLayout((prev) => {
      const merged: LayoutMap = { ...prev };
      for (const id of Object.keys(prev)) {
        if (stored[id]) merged[id] = { ...prev[id], ...stored[id] };
      }
      return merged;
    });
  }, []);

  const updatePosition = useCallback((id: string, x: number, y: number) => {
    setLayout((prev) => {
      const next = { ...prev, [id]: { ...prev[id], x, y } };
      saveStoredLayout(next);
      return next;
    });
  }, []);

  const toggleMinimize = useCallback((id: string) => {
    setLayout((prev) => {
      const next = {
        ...prev,
        [id]: { ...prev[id], minimized: !prev[id]?.minimized },
      };
      saveStoredLayout(next);
      return next;
    });
  }, []);

  const closeWindow = useCallback((id: string) => {
    setLayout((prev) => {
      const next = { ...prev, [id]: { ...prev[id], closed: true } };
      saveStoredLayout(next);
      return next;
    });
  }, []);

  const bringToFront = useCallback((id: string) => {
    setOrder((prev) => [...prev.filter((item) => item !== id), id]);
  }, []);

  const openWindow = useCallback(
    (id: string) => {
      setLayout((prev) => {
        const next = {
          ...prev,
          [id]: { ...prev[id], closed: false, minimized: false },
        };
        saveStoredLayout(next);
        return next;
      });
      bringToFront(id);
    },
    [bringToFront],
  );

  const resetLayout = useCallback(() => {
    setLayout(defaults);
    saveStoredLayout(defaults);
    setOrder(Object.keys(defaults));
  }, [defaults]);

  const zIndexOf = useCallback((id: string) => 10 + order.indexOf(id), [order]);

  return {
    layout,
    updatePosition,
    toggleMinimize,
    closeWindow,
    openWindow,
    bringToFront,
    resetLayout,
    zIndexOf,
  };
}
