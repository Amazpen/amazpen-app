"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const supabase = createClient();

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      {
        redirectTo: `${window.location.origin}/reset-password`,
      }
    );

    setIsLoading(false);

    if (resetError) {
      setError("שגיאה בשליחת הקישור. נסה שוב.");
      return;
    }

    setSuccess(true);
  };

  if (success) {
    return (
      <div
        dir="rtl"
        className="min-h-screen flex flex-col items-center justify-center px-[20px] py-[40px] bg-[#0F1231]"
      >
        <div className="w-full max-w-[400px] flex flex-col items-center gap-[20px]">
          {/* Success Icon */}
          <div className="w-[80px] h-[80px] rounded-full bg-[#3CD856]/20 flex items-center justify-center">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" className="text-[#3CD856]">
              <path d="M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12Z" stroke="currentColor" strokeWidth="2"/>
              <path d="M8 12L11 15L16 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>

          <h1 className="text-[24px] font-bold text-white text-center">הקישור נשלח!</h1>
          <p className="text-[14px] text-white/60 text-center leading-[1.6]">
            שלחנו קישור לאיפוס סיסמה לכתובת
            <br />
            <span className="text-white font-medium">{email}</span>
            <br />
            בדוק את תיבת הדואר שלך
          </p>

          <Link
            href="/login"
            className="w-full h-[50px] bg-[#29318A] text-white text-[16px] font-bold rounded-[10px] flex items-center justify-center transition-all duration-200 hover:bg-[#3D44A0] mt-[10px]"
          >
            חזרה להתחברות
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      dir="rtl"
      className="min-h-screen flex flex-col items-center justify-center px-[20px] py-[40px] bg-[#0F1231]"
    >
      {/* Logo and Header */}
      <div className="flex flex-col items-center gap-[15px] mb-[30px]">
        <Image
          src="https://ae8ccc76b2d94d531551691b1d6411c9.cdn.bubble.io/cdn-cgi/image/w=192,h=91,f=auto,dpr=2,fit=contain/f1740495696315x242439751655884480/logo%20white.png"
          alt="Amazpen Logo"
          className="w-[140px] h-auto"
          width={140}
          height={66}
          unoptimized
        />
        <h1 className="text-[24px] font-bold text-white">שחזור סיסמה</h1>
        <p className="text-[14px] text-white/60 text-center">
          הזן את כתובת האימייל שלך ונשלח לך קישור לאיפוס הסיסמה
        </p>
      </div>

      {/* Form Container */}
      <div className="w-full max-w-[400px] flex flex-col gap-[20px]">
        <form onSubmit={handleSubmit} className="flex flex-col gap-[20px]">
          {/* Email Input */}
          <div className="flex flex-col gap-[8px]">
            <label className="text-[14px] font-medium text-white">כתובת אימייל</label>
            <div className="relative">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="הזן כתובת מייל..."
                required
                className="w-full h-[50px] bg-white text-[#0F1231] text-[14px] text-right rounded-[10px] border-none outline-none px-[15px] pr-[45px] placeholder:text-[#9CA3AF]"
              />
              <div className="absolute top-1/2 right-[12px] -translate-y-1/2 text-[#6B7280]">
                <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
                  <rect x="4" y="8" width="24" height="16" rx="2" stroke="currentColor" strokeWidth="2"/>
                  <path d="M4 10L16 18L28 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-[#F64E60]/20 rounded-[10px] p-[12px]">
              <p className="text-[13px] text-[#F64E60] text-center">{error}</p>
            </div>
          )}

          {/* Submit Button */}
          <Button
            type="submit"
            disabled={isLoading || !email}
            className="w-full h-[50px] bg-[#29318A] text-white text-[16px] font-bold rounded-[10px] transition-all duration-200 hover:bg-[#3D44A0] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-[8px]"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                שולח...
              </>
            ) : (
              "שלח קישור לאיפוס"
            )}
          </Button>
        </form>

        {/* Back to Login */}
        <div className="text-center">
          <Link
            href="/login"
            className="text-[14px] text-white/70 hover:text-white transition-colors inline-flex items-center gap-[6px]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="rotate-180">
              <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            חזרה להתחברות
          </Link>
        </div>
      </div>
    </div>
  );
}
