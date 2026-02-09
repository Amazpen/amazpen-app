"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/**
 * useState wrapper that persists to localStorage.
 * Handles SSR hydration safely — always starts with initialValue on server,
 * then loads saved value on client mount.
 */
export function usePersistedState<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(initialValue);
  const isHydrated = useRef(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) {
        setState(JSON.parse(saved));
      }
    } catch {
      // Invalid JSON or localStorage unavailable
    }
    isHydrated.current = true;
  }, [key]);

  // Save to localStorage on change (skip initial mount)
  useEffect(() => {
    if (isHydrated.current) {
      try {
        localStorage.setItem(key, JSON.stringify(state));
      } catch {
        // localStorage full or unavailable
      }
    }
  }, [key, state]);

  const setPersistedState = useCallback((value: T | ((prev: T) => T)) => {
    setState(value);
  }, []);

  return [state, setPersistedState];
}
