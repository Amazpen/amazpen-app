"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    searchParams.get("error") === "business_inactive"
      ? "החשבון שלך הושבת. פנה למנהל המערכת."
      : searchParams.get("error") === "auth_callback_error"
        ? "שגיאה בהתחברות. נסה שוב."
        : null
  );
  const [showPassword, setShowPassword] = useState(false);
  const [_isGoogleLoading, setIsGoogleLoading] = useState(false);

  const _handleGoogleLogin = async () => {
    if (!agreedToTerms) {
      setError("יש לאשר את תנאי השימוש ומדיניות הפרטיות");
      return;
    }

    setIsGoogleLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (authError) {
      setIsGoogleLoading(false);
      setError("שגיאה בהתחברות עם גוגל. נסה שוב.");
    }
  };

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
      <div className="flex flex-col items-center mb-[30px]">
        <Image
          src="https://ae8ccc76b2d94d531551691b1d6411c9.cdn.bubble.io/cdn-cgi/image/w=192,h=91,f=auto,dpr=2,fit=contain/f1740495696315x242439751655884480/logo%20white.png"
          alt="Amazpen Logo"
          className="w-[160px] h-auto mb-[8px]"
          width={160}
          height={76}
          unoptimized
        />
        <h1 className="text-[28px] font-bold text-white mb-[4px]">המצפן כניסה</h1>
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
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="הזן כתובת מייל..."
                required
                autoComplete="username"
                className="w-full h-[50px] bg-white! text-[#0F1231] text-[14px] text-right rounded-[10px] border-none outline-none px-[15px] pr-[45px] placeholder:text-[#9CA3AF] shadow-none"
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
              <Input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="הזן סיסמה..."
                required
                autoComplete="current-password"
                className="w-full h-[50px] bg-white! text-[#0F1231] text-[14px] text-right rounded-[10px] border-none outline-none px-[15px] pr-[45px] placeholder:text-[#9CA3AF] shadow-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                title={showPassword ? "הסתר סיסמה" : "הצג סיסמה"}
                aria-label={showPassword ? "הסתר סיסמה" : "הצג סיסמה"}
                className="absolute top-1/2 right-[12px] -translate-y-1/2 text-[#6B7280] hover:text-[#374151] transition-colors p-0 bg-transparent border-none cursor-pointer"
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
            <div className="flex items-center gap-[8px]">
              <Checkbox
                checked={rememberMe}
                onCheckedChange={(checked) => setRememberMe(!!checked)}
                className="w-[20px] h-[20px] bg-white rounded-[4px] border-2 border-[#D1D5DB] data-[state=checked]:bg-[#29318A] data-[state=checked]:border-[#29318A]"
              />
              <span className="text-[13px] text-white">זכור אותי</span>
            </div>
            <Link
              href="/forgot-password"
              className="text-[13px] text-white/70 hover:text-white transition-colors underline"
            >
              שכחתי סיסמא
            </Link>
          </div>

          {/* Terms Agreement */}
          <div className="flex items-start gap-[10px] bg-[#29318A]/20 rounded-[10px] p-[12px]">
            <Checkbox
              checked={agreedToTerms}
              onCheckedChange={(checked) => setAgreedToTerms(!!checked)}
              className="w-[20px] h-[20px] bg-white rounded-[4px] border-2 border-[#D1D5DB] data-[state=checked]:bg-[#29318A] data-[state=checked]:border-[#29318A] flex-shrink-0 mt-[2px]"
            />
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
          <Button
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
          </Button>
        </form>

        {/* TODO: Enable Google OAuth when Supabase provider is configured */}
        {/* <div className="flex items-center gap-[12px]">
          <div className="flex-1 h-[1px] bg-white/20" />
          <span className="text-[13px] text-white/50">או</span>
          <div className="flex-1 h-[1px] bg-white/20" />
        </div>
        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={isGoogleLoading}
          className="w-full h-[50px] bg-white text-[#0F1231] text-[15px] font-medium rounded-[10px] transition-all duration-200 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-[10px] shadow-[0px_4px_15px_-5px_rgba(0,0,0,0.2)]"
        >
          {isGoogleLoading ? (
            <>
              <svg className="animate-spin h-5 w-5 text-[#0F1231]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              מתחבר...
            </>
          ) : (
            <>
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              התחברות עם Google
            </>
          )}
        </button> */}

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

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#0F1231]">
        <div className="animate-spin w-8 h-8 border-4 border-[#4A56D4]/30 border-t-[#4A56D4] rounded-full" />
      </div>
    }>
      <LoginPageContent />
    </Suspense>
  );
}
