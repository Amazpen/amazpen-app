"use client";

import { useEffect, useRef, useCallback } from "react";
import { NextStepProvider, NextStep, useNextStep } from "nextstepjs";
import { usePathname } from "next/navigation";
import { useOnboarding } from "@/hooks/useOnboarding";
import { OnboardingCard } from "./OnboardingCard";
import { allTours, tourNameForPath } from "./tours";

function OnboardingAutoStarter() {
  const pathname = usePathname();
  const { completedTours } = useOnboarding();
  const { startNextStep, isNextStepVisible } = useNextStep();
  const hasAutoStarted = useRef<Set<string>>(new Set());

  // Use refs to avoid stale closures in the timeout
  const completedToursRef = useRef(completedTours);
  completedToursRef.current = completedTours;
  const isVisibleRef = useRef(isNextStepVisible);
  isVisibleRef.current = isNextStepVisible;

  useEffect(() => {
    const tourName = tourNameForPath[pathname];
    if (!tourName) return;
    if (hasAutoStarted.current.has(tourName)) return;

    hasAutoStarted.current.add(tourName);

    // Delay to allow hydration + page content to render
    const timer = setTimeout(() => {
      // Check completed state at execution time (not capture time)
      if (completedToursRef.current[tourName]) return;
      if (isVisibleRef.current) return;
      startNextStep(tourName);
    }, 1500);

    return () => clearTimeout(timer);
    // Only re-run when pathname changes - refs handle the rest
  }, [pathname, startNextStep]);

  return null;
}

interface OnboardingProviderProps {
  children: React.ReactNode;
}

export function OnboardingProvider({ children }: OnboardingProviderProps) {
  const pathname = usePathname();
  const { markTourCompleted } = useOnboarding();

  const handleComplete = useCallback(
    (tourName: string | null) => {
      const name = tourName || tourNameForPath[pathname];
      if (name) markTourCompleted(name);
    },
    [pathname, markTourCompleted]
  );

  const handleSkip = useCallback(
    (_step: number, tourName: string | null) => {
      const name = tourName || tourNameForPath[pathname];
      if (name) markTourCompleted(name);
    },
    [pathname, markTourCompleted]
  );

  return (
    <NextStepProvider>
      <NextStep
        steps={allTours}
        cardComponent={OnboardingCard}
        shadowRgb="15,18,49"
        shadowOpacity="0.8"
        onComplete={handleComplete}
        onSkip={handleSkip}
      >
        <OnboardingAutoStarter />
        {children}
      </NextStep>
    </NextStepProvider>
  );
}
