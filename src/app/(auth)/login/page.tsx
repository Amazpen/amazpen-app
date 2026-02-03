"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!agreedToTerms) {
      setError("יש לאשר את תנאי השימוש ומדיניות הפרטיות");
      return;
    }

    setIsLoading(true);
    setError(null);

    const supabase = createClient();

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (authError) {
      setIsLoading(false);
      if (authError.message.includes("Invalid login credentials")) {
        setError("אימייל או סיסמה שגויים");
      } else if (authError.message.includes("Email not confirmed")) {
        setError("יש לאמת את כתובת האימייל לפני התחברות");
      } else {
        setError("שגיאה בהתחברות. נסה שוב.");
      }
      return;
    }

    // Success - redirect to dashboard
    router.push("/");
    router.refresh();
  };

  return (
    <div
      dir="rtl"
      className="min-h-screen flex flex-col items-center justify-center px-[20px] py-[40px] bg-[#0F1231]"
    >
      {/* Logo and Header */}
      <div className="flex flex-col items-center gap-[15px] mb-[30px]">
        <img
          src="https://ae8ccc76b2d94d531551691b1d6411c9.cdn.bubble.io/cdn-cgi/image/w=192,h=91,f=auto,dpr=2,fit=contain/f1740495696315x242439751655884480/logo%20white.png"
          alt="Amazpen Logo"
          className="w-[160px] h-auto"
        />
        <h1 className="text-[28px] font-bold text-white">המצפן כניסה</h1>
        <p className="text-[14px] text-white/60 text-center">
          בשביל לנצח בעסקים חייבים להכיר את החוקים
        </p>
      </div>

      {/* Login Form Container */}
      <div className="w-full max-w-[400px] flex flex-col gap-[20px]">
        <form onSubmit={handleLogin} className="flex flex-col gap-[20px]">
          {/* Email Input */}
          <div className="flex flex-col gap-[8px]">
            <label className="text-[14px] font-medium text-white">שם משתמש</label>
            <div className="relative">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="הזן כתובת מייל..."
                required
                className="w-full h-[50px] bg-white text-[#0F1231] text-[14px] text-right rounded-[10px] border-none outline-none px-[15px] pr-[45px] placeholder:text-[#9CA3AF]"
              />
              <div className="absolute top-1/2 right-[12px] -translate-y-1/2 text-[#6B7280]">
                <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
                  <path d="M16 4C12.6863 4 10 6.68629 10 10C10 13.3137 12.6863 16 16 16C19.3137 16 22 13.3137 22 10C22 6.68629 19.3137 4 16 4Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M8 28C8 23.5817 11.5817 20 16 20C20.4183 20 24 23.5817 24 28" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
            </div>
          </div>

          {/* Password Input */}
          <div className="flex flex-col gap-[8px]">
            <label className="text-[14px] font-medium text-white">סיסמא</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="הזן סיסמה..."
                required
                autoComplete="current-password"
                className="w-full h-[50px] bg-white text-[#0F1231] text-[14px] text-right rounded-[10px] border-none outline-none px-[15px] pr-[45px] placeholder:text-[#9CA3AF]"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                title={showPassword ? "הסתר סיסמה" : "הצג סיסמה"}
                aria-label={showPassword ? "הסתר סיסמה" : "הצג סיסמה"}
                className="absolute top-1/2 right-[12px] -translate-y-1/2 text-[#6B7280] hover:text-[#374151] transition-colors"
              >
                <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
                  <rect x="8" y="12" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="2"/>
                  <path d="M12 12V8C12 5.79086 13.7909 4 16 4C18.2091 4 20 5.79086 20 8V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <circle cx="16" cy="19" r="2" fill="currentColor"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Remember Me & Forgot Password Row */}
          <div className="flex items-center justify-between">
            <Link
              href="/forgot-password"
              className="text-[13px] text-white/70 hover:text-white transition-colors underline"
            >
              שכחתי סיסמא
            </Link>
            <div className="flex items-center gap-[8px]">
              <span className="text-[13px] text-white">זכור אותי</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-[20px] h-[20px] bg-white rounded-[4px] border-2 border-[#D1D5DB] peer-checked:bg-[#29318A] peer-checked:border-[#29318A] flex items-center justify-center transition-colors">
                  {rememberMe && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                      <path d="M5 12L10 17L19 8" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
              </label>
            </div>
          </div>

          {/* Terms Agreement */}
          <div className="flex items-start gap-[10px] bg-[#29318A]/20 rounded-[10px] p-[12px]">
            <label className="relative inline-flex items-center cursor-pointer mt-[2px]">
              <input
                type="checkbox"
                checked={agreedToTerms}
                onChange={(e) => setAgreedToTerms(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-[20px] h-[20px] bg-white rounded-[4px] border-2 border-[#D1D5DB] peer-checked:bg-[#29318A] peer-checked:border-[#29318A] flex items-center justify-center transition-colors flex-shrink-0">
                {agreedToTerms && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path d="M5 12L10 17L19 8" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
            </label>
            <span className="text-[12px] text-white/80 leading-[1.6]">
              אני מסכימ/ה ל-
              <a
                href="https://amazpenbiz.co.il/usage_policy"
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-white hover:underline"
              >
                תנאי שימוש
              </a>
              {" "}וקראתי את{" "}
              <a
                href="https://amazpenbiz.co.il/privacy_policy"
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-white hover:underline"
              >
                מדיניות הפרטיות
              </a>
              {" "}של Amazpen
            </span>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-[#F64E60]/20 rounded-[10px] p-[12px]">
              <p className="text-[13px] text-[#F64E60] text-center">{error}</p>
            </div>
          )}

          {/* Login Button */}
          <button
            type="submit"
            disabled={isLoading || !email || !password}
            className="w-full h-[50px] bg-[#29318A] text-white text-[16px] font-bold rounded-[10px] transition-all duration-200 hover:bg-[#3D44A0] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-[8px] shadow-[0px_7px_30px_-10px_rgba(41,49,138,0.3)]"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                מתחבר...
              </>
            ) : (
              "התחברות"
            )}
          </button>
        </form>

        {/* Info */}
        <div className="text-center">
          <p className="text-[12px] text-white/50">
            אין לך חשבון? פנה למנהל המערכת
          </p>
        </div>
      </div>
    </div>
  );
}
