"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";

interface NumberInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  inputMode?: "decimal" | "numeric";
  disabled?: boolean;
}

function formatWithCommas(val: string): string {
  if (!val) return "";
  // Remove existing commas
  const clean = val.replace(/,/g, "");
  // Split on decimal point
  const parts = clean.split(".");
  // Add commas to integer part
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}

function stripCommas(val: string): string {
  return val.replace(/,/g, "");
}

export function NumberInput({
  value,
  onChange,
  placeholder = "0",
  className = "",
  inputMode = "decimal",
  disabled = false,
}: NumberInputProps) {
  const [displayValue, setDisplayValue] = useState(() => formatWithCommas(value));
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync display value when external value changes (and not focused)
  const prevValueRef = useRef(value);
  useEffect(() => {
    if (!isFocused && value !== prevValueRef.current) {
      // Use requestAnimationFrame to avoid synchronous setState in effect
      const id = requestAnimationFrame(() => setDisplayValue(formatWithCommas(value)));
      prevValueRef.current = value;
      return () => cancelAnimationFrame(id);
    }
    prevValueRef.current = value;
  }, [value, isFocused]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      // Allow digits, decimal point, minus, and commas
      const cleaned = raw.replace(/[^0-9.,-]/g, "");
      // Strip commas for the raw value
      const rawValue = stripCommas(cleaned);

      // Validate it's a valid number pattern (allow empty, minus, partial decimals)
      if (rawValue && !/^-?\d*\.?\d*$/.test(rawValue)) return;

      setDisplayValue(cleaned);
      onChange(rawValue);
    },
    [onChange]
  );

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    // Show raw value (without commas) on focus for easier editing
    setDisplayValue(value);
  }, [value]);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    // Format with commas on blur
    setDisplayValue(formatWithCommas(value));
  }, [value]);

  return (
    <Input
      ref={inputRef}
      type="text"
      inputMode={inputMode}
      placeholder={placeholder}
      value={displayValue}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      disabled={disabled}
      className={className}
    />
  );
}
