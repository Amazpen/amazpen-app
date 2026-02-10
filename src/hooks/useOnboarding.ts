"use client";

import { useCallback } from "react";
import { usePersistedState } from "./usePersistedState";

export function useOnboarding() {
  const [completedTours, setCompletedTours] = usePersistedState<Record<string, boolean>>(
    "amazpen:completedTours",
    {}
  );

  const isTourCompleted = useCallback(
    (tourName: string) => !!completedTours[tourName],
    [completedTours]
  );

  const markTourCompleted = useCallback(
    (tourName: string) =>
      setCompletedTours((prev) => ({ ...prev, [tourName]: true })),
    [setCompletedTours]
  );

  const resetTour = useCallback(
    (tourName: string) =>
      setCompletedTours((prev) => {
        const next = { ...prev };
        delete next[tourName];
        return next;
      }),
    [setCompletedTours]
  );

  const resetAllTours = useCallback(
    () => setCompletedTours({}),
    [setCompletedTours]
  );

  return { isTourCompleted, markTourCompleted, resetTour, resetAllTours, completedTours };
}
