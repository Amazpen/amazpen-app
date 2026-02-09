"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/**
 * useState wrapper that persists to localStorage.
 * Restores from localStorage after hydration to avoid React hydration mismatch.
 */
export function usePersistedState<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(initialValue);
  const initialized = useRef(false);

  // Restore from localStorage after hydration (client only)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) {
        setState(JSON.parse(saved) as T);
      }
    } catch {
      // Invalid JSON or localStorage unavailable
    }
    // Mark as initialized after restore attempt
    initialized.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save to localStorage on change (skip until initialized)
  useEffect(() => {
    if (!initialized.current) return;
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // localStorage full or unavailable
    }
  }, [key, state]);

  const setPersistedState = useCallback((value: T | ((prev: T) => T)) => {
    setState(value);
  }, []);

  return [state, setPersistedState];
}
