"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Hook for saving/restoring form drafts in localStorage.
 * Unlike usePersistedState (which wraps a single useState),
 * this hook manages an entire form's state as a single JSON blob.
 *
 * Usage:
 *   const { saveDraft, restoreDraft, clearDraft } = useFormDraft(draftKey);
 *   // Save on every change via useEffect
 *   // Restore after form opens / dynamic data loads
 *   // Clear only on successful submit
 */
export function useFormDraft<T extends Record<string, unknown>>(key: string) {
  const draftCleared = useRef(false);

  const saveDraft = useCallback(
    (data: T) => {
      if (draftCleared.current) return;
      try {
        localStorage.setItem(key, JSON.stringify(data));
      } catch {
        // localStorage full or unavailable
      }
    },
    [key]
  );

  const restoreDraft = useCallback((): T | null => {
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        return JSON.parse(saved) as T;
      }
    } catch {
      // Invalid JSON or localStorage unavailable
    }
    return null;
  }, [key]);

  const clearDraft = useCallback(() => {
    draftCleared.current = true;
    try {
      localStorage.removeItem(key);
    } catch {
      // localStorage unavailable
    }
  }, [key]);

  const resetCleared = useCallback(() => {
    draftCleared.current = false;
  }, []);

  // Reset the cleared flag when key changes (e.g., different business)
  useEffect(() => {
    draftCleared.current = false;
  }, [key]);

  return { saveDraft, restoreDraft, clearDraft, resetCleared };
}
