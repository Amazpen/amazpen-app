"use client";

import { useNextStep } from "nextstepjs";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { tourNameForPath } from "./tours";
import { useOnboarding } from "@/hooks/useOnboarding";

export function HelpButton() {
  const { startNextStep } = useNextStep();
  const pathname = usePathname();
  const { resetTour } = useOnboarding();

  const tourName = tourNameForPath[pathname];

  if (!tourName) return null;

  const handleClick = () => {
    resetTour(tourName);
    startNextStep(tourName);
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={handleClick}
      className="w-[34px] sm:w-[32px] aspect-square self-center rounded-full bg-[#29318A] flex items-center justify-center cursor-pointer hover:bg-[#3D44A0] transition-colors touch-manipulation"
      aria-label="הדרכה"
      title="הצג הדרכה"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        className="text-[#FFA412]"
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="17" r="1" fill="currentColor" />
      </svg>
    </Button>
  );
}
