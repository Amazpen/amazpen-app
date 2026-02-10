"use client";

import { useEffect, useRef, useCallback } from "react";
import { NextStepProvider, NextStep, useNextStep } from "nextstepjs";
import { usePathname } from "next/navigation";
import { useOnboarding } from "@/hooks/useOnboarding";
import { OnboardingCard } from "./OnboardingCard";
import { allTours, tourNameForPath } from "./tours";

function OnboardingAutoStarter() {
  const pathname = usePathname();
  const { isTourCompleted } = useOnboarding();
  const { startNextStep, isNextStepVisible } = useNextStep();
  const hasAutoStarted = useRef<Set<string>>(new Set());

  useEffect(() => {
    const tourName = tourNameForPath[pathname];
    if (!tourName) return;
    if (isTourCompleted(tourName)) return;
    if (hasAutoStarted.current.has(tourName)) return;
    if (isNextStepVisible) return;

    const timer = setTimeout(() => {
      hasAutoStarted.current.add(tourName);
      startNextStep(tourName);
    }, 800);

    return () => clearTimeout(timer);
  }, [pathname, isTourCompleted, startNextStep, isNextStepVisible]);

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
