"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import type { CardComponentProps } from "nextstepjs";

export function OnboardingCard({
  step,
  currentStep,
  totalSteps,
  nextStep,
  prevStep,
  skipTour,
  arrow,
}: CardComponentProps) {
  const isLastStep = currentStep === totalSteps - 1;
  const isFirstStep = currentStep === 0;
  const handleSkip = skipTour ?? (() => {});

  return (
    <div
      dir="rtl"
      className="bg-[#29318a] border border-white/10 rounded-[14px] shadow-[0_10px_40px_rgba(0,0,0,0.5)] p-5 min-w-[280px] max-w-[340px] relative"
    >
      {arrow}

      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 flex-1">
          {step.icon && (
            <span className="text-2xl flex-shrink-0">{step.icon}</span>
          )}
          {step.title && (
            <h3 className="text-white text-[16px] font-bold leading-tight">
              {step.title}
            </h3>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleSkip}
          className="text-white/40 hover:text-white/70 transition-colors flex-shrink-0 mt-0.5"
          aria-label="סגור"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M18 6L6 18M6 6l12 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </Button>
      </div>

      {/* Content */}
      <div className="text-white/80 text-[13px] leading-relaxed mb-4">
        {step.content}
      </div>

      {/* Progress Dots */}
      <div className="flex items-center gap-1.5 mb-4">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div
            key={i}
            className={`rounded-full transition-all duration-300 ${
              i === currentStep
                ? "w-[8px] h-[8px] bg-[#6366f1]"
                : i < currentStep
                  ? "w-[6px] h-[6px] bg-[#6366f1]/50"
                  : "w-[6px] h-[6px] bg-white/20"
            }`}
          />
        ))}
        <span className="text-white/40 text-[11px] mr-auto">
          {currentStep + 1} / {totalSteps}
        </span>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        {step.showSkip !== false && (
          <Button
            type="button"
            variant="ghost"
            onClick={handleSkip}
            className="text-white/40 hover:text-white/60 text-[12px] transition-colors"
          >
            דלג
          </Button>
        )}

        <div className="flex items-center gap-2 mr-auto">
          {!isFirstStep && (
            <Button
              type="button"
              variant="outline"
              onClick={prevStep}
              className="border border-white/20 text-white/70 hover:text-white hover:border-white/40 rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium transition-all"
            >
              הקודם
            </Button>
          )}
          <Button
            type="button"
            onClick={nextStep}
            className="bg-[#6366f1] hover:bg-[#5558e3] text-white rounded-[7px] px-4 py-1.5 text-[13px] font-bold transition-all"
          >
            {isLastStep ? "סיום" : "הבא"}
          </Button>
        </div>
      </div>
    </div>
  );
}
