'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SupplierSearchSelectProps {
  suppliers: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  emptyMessage?: string;
}

export default function SupplierSearchSelect({
  suppliers,
  value,
  onChange,
  placeholder = 'בחר/י ספק...',
  label = 'שם ספק',
  disabled = false,
  emptyMessage,
}: SupplierSearchSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedSupplier = useMemo(
    () => suppliers.find((s) => s.id === value),
    [suppliers, value]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return suppliers;
    const q = search.trim().toLowerCase();
    return suppliers.filter((s) => s.name.toLowerCase().includes(q));
  }, [suppliers, search]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Focus input when dropdown opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleSelect = (id: string) => {
    onChange(id);
    setIsOpen(false);
    setSearch('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setSearch('');
    setIsOpen(false);
  };

  return (
    <div className="flex flex-col gap-[3px]">
      <label className="text-[15px] font-medium text-white text-right">
        {label}
      </label>

      <div ref={containerRef} className="relative">
        {/* Trigger / Display */}
        <div
          onClick={() => { if (!disabled) setIsOpen(!isOpen); }}
          className={`flex items-center justify-between border border-[#4C526B] rounded-[10px] h-[48px] bg-[#0F1535] px-[12px] cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <span className={`text-[16px] flex-1 text-center ${selectedSupplier ? 'text-white' : 'text-white/40'}`}>
            {selectedSupplier ? selectedSupplier.name : (emptyMessage && suppliers.length === 0 ? emptyMessage : placeholder)}
          </span>
          {value && !disabled && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClear}
              className="text-white/40 hover:text-white transition-colors mr-[4px] text-[18px] leading-none"
              title="נקה בחירה"
            >
              ✕
            </Button>
          )}
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={`text-white/40 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>

        {/* Dropdown */}
        {isOpen && (
          <div className="absolute top-[52px] left-0 right-0 z-50 bg-[#0F1535] border border-[#4C526B] rounded-[10px] shadow-lg shadow-black/40 overflow-hidden">
            {/* Search input */}
            <div className="p-[8px] border-b border-[#4C526B]/50">
              <div className="flex items-center gap-[8px] bg-[#1a2044] rounded-[8px] px-[10px] h-[40px]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/40 flex-shrink-0">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <Input
                  ref={inputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="חפש ספק..."
                  className="flex-1 bg-transparent text-white text-[14px] text-right outline-none placeholder:text-white/30"
                />
              </div>
            </div>

            {/* Options list */}
            <div className="max-h-[200px] overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="text-white/40 text-[14px] text-center py-[12px]">
                  לא נמצאו תוצאות
                </div>
              ) : (
                filtered.map((supplier) => (
                  <div
                    key={supplier.id}
                    onClick={() => handleSelect(supplier.id)}
                    className={`px-[14px] py-[10px] text-[15px] text-right cursor-pointer transition-colors hover:bg-[#29318A]/40 ${supplier.id === value ? 'bg-[#29318A]/30 text-[#00D4FF]' : 'text-white'}`}
                  >
                    {supplier.name}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
