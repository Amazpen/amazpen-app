"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";

// Toast types
type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  toasts: Toast[];
  showToast: (message: string, type?: ToastType) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

// Toast Provider Component
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);

    // Auto remove after 4 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, showToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </ToastContext.Provider>
  );
}

// Hook to use toast
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

// Toast Container Component
function ToastContainer({
  toasts,
  removeToast,
}: {
  toasts: Toast[];
  removeToast: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 w-[calc(100%-20px)] max-w-[400px]">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
      ))}
    </div>
  );
}

// Single Toast Item
function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const getStyles = () => {
    switch (toast.type) {
      case "success":
        return {
          bg: "bg-[#17DB4E]",
          icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ),
        };
      case "error":
        return {
          bg: "bg-[#F64E60]",
          icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" strokeLinecap="round" />
              <line x1="9" y1="9" x2="15" y2="15" strokeLinecap="round" />
            </svg>
          ),
        };
      case "warning":
        return {
          bg: "bg-[#FFCF00]",
          icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ),
        };
      default: // info
        return {
          bg: "bg-[#29318A]",
          icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" strokeLinecap="round" />
              <line x1="12" y1="8" x2="12.01" y2="8" strokeLinecap="round" />
            </svg>
          ),
        };
    }
  };

  const styles = getStyles();

  return (
    <div
      dir="rtl"
      className={`${styles.bg} rounded-[10px] p-[12px_15px] shadow-lg flex items-center gap-[10px] animate-slide-down`}
    >
      <div className="flex-shrink-0">{styles.icon}</div>
      <p className="text-white text-[14px] font-medium flex-1 text-right">{toast.message}</p>
      <button
        type="button"
        onClick={onClose}
        className="flex-shrink-0 text-white/70 hover:text-white transition-colors"
        aria-label="סגור הודעה"
        title="סגור"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" />
          <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
