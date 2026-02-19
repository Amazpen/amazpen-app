"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { uploadFile } from "@/lib/uploadFile";
import { useToast } from "@/components/ui/toast";
import { useDashboard } from "../layout";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  created_at: string | null;
}

interface UserBusiness {
  role: string;
  business_name: string;
}

export default function SettingsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { refreshProfile } = useDashboard();
  const { isSubscribed, isSupported, isLoading: pushLoading, permission, subscribe, unsubscribe } = usePushSubscription();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [emailConfirm, setEmailConfirm] = useState("");

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [businesses, setBusinesses] = useState<UserBusiness[]>([]);

  // Fetch user profile
  useEffect(() => {
    const fetchProfile = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      const { data: profileData } = await supabase
        .from("profiles")
        .select("id, email, full_name, phone, avatar_url, created_at")
        .eq("id", user.id)
        .single();

      if (profileData) {
        setProfile(profileData);
        setFullName(profileData.full_name || "");
        setPhone(profileData.phone || "");
        setAvatarUrl(profileData.avatar_url);
      }

      // Fetch user businesses
      const { data: memberData } = await supabase
        .from("business_members")
        .select("role, businesses(name)")
        .eq("user_id", user.id)
        .is("deleted_at", null);

      if (memberData) {
        setBusinesses(
          memberData.map((m: Record<string, unknown>) => ({
            role: m.role as string,
            business_name: (m.businesses as Record<string, unknown>)?.name as string || "",
          }))
        );
      }

      setIsLoading(false);
    };

    fetchProfile();
  }, [router]);

  // Handle avatar file selection
  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      showToast("יש להעלות קובץ תמונה בלבד", "error");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      showToast("גודל התמונה המקסימלי הוא 2MB", "error");
      return;
    }

    // Show preview immediately
    const reader = new FileReader();
    reader.onloadend = () => {
      setAvatarPreview(reader.result as string);
    };
    reader.readAsDataURL(file);

    // Upload
    setIsUploadingAvatar(true);
    const fileExt = file.name.split(".").pop();
    const fileName = `avatars/${profile?.id}-${Date.now()}.${fileExt}`;

    const result = await uploadFile(file, fileName, "assets");

    if (result.success && result.publicUrl) {
      setAvatarUrl(result.publicUrl);
      setAvatarPreview(null);

      // Update profile in DB
      const supabase = createClient();
      await supabase
        .from("profiles")
        .update({ avatar_url: result.publicUrl, updated_at: new Date().toISOString() })
        .eq("id", profile?.id);

      showToast("תמונת הפרופיל עודכנה בהצלחה", "success");
      refreshProfile();
    } else {
      showToast("שגיאה בהעלאת התמונה", "error");
      setAvatarPreview(null);
    }

    setIsUploadingAvatar(false);
  };

  // Save profile changes
  const handleSaveProfile = async () => {
    if (!profile) return;

    setIsSaving(true);

    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: fullName.trim() || null,
        phone: phone.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", profile.id);

    if (error) {
      showToast("שגיאה בשמירת הפרופיל", "error");
    } else {
      setProfile(prev => prev ? { ...prev, full_name: fullName.trim() || null, phone: phone.trim() || null } : null);
      showToast("הפרופיל עודכן בהצלחה", "success");
      refreshProfile();
    }

    setIsSaving(false);
  };

  // Handle password change (with current password)
  const handleChangePassword = async () => {
    if (!forgotMode && !currentPassword) {
      showToast("יש להזין סיסמה נוכחית", "error");
      return;
    }
    if (forgotMode && emailConfirm.trim().toLowerCase() !== profile?.email?.toLowerCase()) {
      showToast("כתובת המייל אינה תואמת", "error");
      return;
    }
    if (!newPassword || !confirmPassword) {
      showToast("יש למלא את כל השדות", "error");
      return;
    }
    if (newPassword.length < 6) {
      showToast("הסיסמה החדשה חייבת להכיל לפחות 6 תווים", "error");
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast("הסיסמאות אינן תואמות", "error");
      return;
    }

    setIsChangingPassword(true);

    const supabase = createClient();

    // If not forgot mode, verify current password first
    if (!forgotMode) {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: profile?.email || "",
        password: currentPassword,
      });

      if (signInError) {
        showToast("הסיסמה הנוכחית שגויה", "error");
        setIsChangingPassword(false);
        return;
      }
    }

    // Update to new password (works because user session is active)
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (updateError) {
      showToast("שגיאה בעדכון הסיסמה", "error");
    } else {
      showToast("הסיסמה עודכנה בהצלחה", "success");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setEmailConfirm("");
      setForgotMode(false);
      setShowPasswordSection(false);
    }

    setIsChangingPassword(false);
  };

  const displayAvatar = avatarPreview || avatarUrl;
  const hasChanges = fullName.trim() !== (profile?.full_name || "") || phone.trim() !== (profile?.phone || "");

  const roleLabels: Record<string, string> = {
    owner: "בעלים",
    manager: "מנהל",
    employee: "עובד",
  };

  if (isLoading) {
    return (
      <div dir="rtl" className="p-4 sm:p-6 pb-[100px]">
        <div className="max-w-[500px] mx-auto">

          {/* Avatar Skeleton */}
          <div className="flex flex-col items-center mb-[30px]">
            <div className="relative mb-[12px]">
              <div className="w-[100px] h-[100px] rounded-full border-[3px] border-[#29318A] bg-[#29318A] animate-pulse" />
              <div className="absolute bottom-0 left-0 w-[32px] h-[32px] bg-[#FFA412]/50 rounded-full animate-pulse" />
            </div>
            <div className="h-4 w-[180px] bg-[#29318A] rounded animate-pulse" />
          </div>

          {/* Fields Skeleton */}
          <div className="space-y-[16px]">
            {/* Name field */}
            <div className="flex flex-col gap-[8px]">
              <div className="h-4 w-[60px] bg-[#29318A] rounded animate-pulse" />
              <div className="w-full h-[48px] bg-[#29318A]/40 rounded-[10px] border border-white/10 animate-pulse" />
            </div>

            {/* Phone field */}
            <div className="flex flex-col gap-[8px]">
              <div className="h-4 w-[50px] bg-[#29318A] rounded animate-pulse" />
              <div className="w-full h-[48px] bg-[#29318A]/40 rounded-[10px] border border-white/10 animate-pulse" />
            </div>

            {/* Email field */}
            <div className="flex flex-col gap-[8px]">
              <div className="h-4 w-[50px] bg-[#29318A] rounded animate-pulse" />
              <div className="w-full h-[48px] bg-[#29318A]/20 rounded-[10px] border border-white/5 animate-pulse" />
            </div>

            {/* Member since field */}
            <div className="flex flex-col gap-[8px]">
              <div className="h-4 w-[70px] bg-[#29318A] rounded animate-pulse" />
              <div className="w-full h-[48px] bg-[#29318A]/20 rounded-[10px] border border-white/5 animate-pulse" />
            </div>
          </div>

          {/* Businesses Skeleton */}
          <div className="mt-[25px] pt-[25px] border-t border-white/10">
            <div className="h-4 w-[80px] bg-[#29318A] rounded animate-pulse mb-[12px]" />
            <div className="w-full h-[48px] bg-[#29318A]/20 rounded-[10px] border border-white/5 animate-pulse" />
          </div>

        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="p-4 sm:p-6 pb-[100px]">
      <div className="max-w-[500px] mx-auto">

        {/* Profile Avatar Section */}
        <div id="onboarding-settings-profile" className="flex flex-col items-center mb-[30px]">
          <div className="relative group mb-[12px]">
            <div className="w-[100px] h-[100px] rounded-full overflow-hidden border-[3px] border-[#29318A] bg-[#29318A] flex items-center justify-center">
              {displayAvatar ? (
                <Image
                  src={displayAvatar}
                  alt="תמונת פרופיל"
                  className="w-full h-full object-cover"
                  width={100}
                  height={100}
                  unoptimized
                  priority
                />
              ) : (
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5">
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" strokeLinecap="round" strokeLinejoin="round"/>
                  <circle cx="12" cy="7" r="4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}

              {/* Upload overlay */}
              {isUploadingAvatar && (
                <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>

            {/* Camera button */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="החלפת תמונת פרופיל"
              aria-label="החלפת תמונת פרופיל"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingAvatar}
              className="absolute bottom-0 left-0 w-[32px] h-[32px] bg-[#FFA412] rounded-full flex items-center justify-center shadow-lg hover:bg-[#FFB94A] transition-colors disabled:opacity-50"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="12" cy="13" r="4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarChange}
              className="hidden"
              title="בחר תמונת פרופיל"
              aria-label="בחר תמונת פרופיל"
            />
          </div>

          <p className="text-white/50 text-[12px]">לחץ על הכפתור להחלפת תמונת פרופיל</p>
        </div>

        {/* Profile Info Section */}
        <div className="space-y-[16px]">
          {/* Full Name */}
          <div className="flex flex-col gap-[8px]">
            <label className="text-[14px] font-medium text-white/80">שם מלא</label>
            <Input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="הזן שם מלא..."
              className="w-full h-[48px] bg-[#29318A]/40 text-white text-[14px] text-right rounded-[10px] border border-white/10 outline-none px-[15px] placeholder:text-white/30 focus:border-[#FFA412]/50 transition-colors"
            />
          </div>

          {/* Phone */}
          <div className="flex flex-col gap-[8px]">
            <label className="text-[14px] font-medium text-white/80">טלפון</label>
            <Input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="...הזן מספר טלפון"
              className="w-full h-[48px] bg-[#29318A]/40 text-white text-[14px] text-right rounded-[10px] border border-white/10 outline-none px-[15px] placeholder:text-white/30 focus:border-[#FFA412]/50 transition-colors"
            />
          </div>

          {/* Email (read-only) */}
          <div className="flex flex-col gap-[8px]">
            <label className="text-[14px] font-medium text-white/80">אימייל</label>
            <div className="w-full h-[48px] bg-[#29318A]/20 text-white/50 text-[14px] text-left rounded-[10px] border border-white/5 px-[15px] flex items-center" dir="ltr">
              {profile?.email}
            </div>
          </div>

          {/* Member Since (read-only) */}
          {profile?.created_at && (
            <div className="flex flex-col gap-[8px]">
              <label className="text-[14px] font-medium text-white/80">חבר מאז</label>
              <div className="w-full h-[48px] bg-[#29318A]/20 text-white/50 text-[14px] text-right rounded-[10px] border border-white/5 px-[15px] flex items-center">
                {new Date(profile.created_at).toLocaleDateString("he-IL", { year: "numeric", month: "long", day: "numeric" })}
              </div>
            </div>
          )}

          {/* Change Password */}
          <div className="flex flex-col gap-[8px]">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowPasswordSection(!showPasswordSection)}
              className="w-full h-[48px] bg-[#29318A]/40 text-white/80 text-[14px] font-medium rounded-[10px] border border-white/10 hover:border-[#FFA412]/50 transition-colors flex items-center justify-center gap-[8px]"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M7 11V7a5 5 0 0110 0v4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>שינוי סיסמה</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform duration-200 ${showPasswordSection ? 'rotate-180' : ''}`}>
                <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Button>

            {showPasswordSection && (
              <form onSubmit={(e) => { e.preventDefault(); handleChangePassword(); }} className="space-y-[12px] mt-[4px] p-[16px] bg-[#29318A]/20 rounded-[10px] border border-white/5">
                {/* Current Password or Forgot Mode */}
                {forgotMode ? (
                  <div className="flex flex-col gap-[6px]">
                    <label className="text-[13px] font-medium text-white/70">אימות זהות — הזן את כתובת המייל שלך</label>
                    <Input
                      type="email"
                      value={emailConfirm}
                      onChange={(e) => setEmailConfirm(e.target.value)}
                      placeholder="הזן כתובת מייל לאימות..."
                      dir="ltr"
                      className="w-full h-[44px] bg-[#29318A]/40 text-white text-[14px] text-left rounded-[10px] border border-white/10 outline-none px-[15px] placeholder:text-white/30 focus:border-[#FFA412]/50 transition-colors"
                    />
                    <Button
                      type="button"
                      variant="link"
                      onClick={() => { setForgotMode(false); setEmailConfirm(""); }}
                      className="text-[12px] text-[#FFA412] hover:text-[#FFB94A] transition-colors self-start mt-[2px] p-0 h-auto"
                    >
                      יש לי סיסמה נוכחית
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-[6px]">
                    <label className="text-[13px] font-medium text-white/70">סיסמה נוכחית</label>
                    <div className="relative">
                      <Input
                        type={showCurrentPassword ? "text" : "password"}
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="הזן סיסמה נוכחית..."
                        autoComplete="current-password"
                        className="w-full h-[44px] bg-[#29318A]/40 text-white text-[14px] text-right rounded-[10px] border border-white/10 outline-none px-[15px] pe-[44px] placeholder:text-white/30 focus:border-[#FFA412]/50 transition-colors"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                        className="absolute left-[12px] top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
                      >
                        {showCurrentPassword ? (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" strokeLinecap="round" strokeLinejoin="round"/>
                            <line x1="1" y1="1" x2="23" y2="23" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        ) : (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" strokeLinecap="round" strokeLinejoin="round"/>
                            <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </Button>
                    </div>
                    <Button
                      type="button"
                      variant="link"
                      onClick={() => { setForgotMode(true); setCurrentPassword(""); }}
                      className="text-[12px] text-[#FFA412] hover:text-[#FFB94A] transition-colors self-end mt-[2px] p-0 h-auto"
                    >
                      לא זוכר סיסמה נוכחית?
                    </Button>
                  </div>
                )}

                {/* New Password */}
                <div className="flex flex-col gap-[6px]">
                  <label className="text-[13px] font-medium text-white/70">סיסמה חדשה</label>
                  <div className="relative">
                    <Input
                      type={showNewPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="הזן סיסמה חדשה (מינימום 6 תווים)..."
                      autoComplete="new-password"
                      className="w-full h-[44px] bg-[#29318A]/40 text-white text-[14px] text-right rounded-[10px] border border-white/10 outline-none px-[15px] pe-[44px] placeholder:text-white/30 focus:border-[#FFA412]/50 transition-colors"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute left-[12px] top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
                    >
                      {showNewPassword ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" strokeLinecap="round" strokeLinejoin="round"/>
                          <line x1="1" y1="1" x2="23" y2="23" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" strokeLinecap="round" strokeLinejoin="round"/>
                          <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </Button>
                  </div>
                </div>

                {/* Confirm Password */}
                <div className="flex flex-col gap-[6px]">
                  <label className="text-[13px] font-medium text-white/70">אימות סיסמה חדשה</label>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="הזן שוב את הסיסמה החדשה..."
                    autoComplete="new-password"
                    className="w-full h-[44px] bg-[#29318A]/40 text-white text-[14px] text-right rounded-[10px] border border-white/10 outline-none px-[15px] placeholder:text-white/30 focus:border-[#FFA412]/50 transition-colors"
                  />
                </div>

                {/* Change Password Button */}
                <Button
                  type="submit"
                  disabled={isChangingPassword || (!forgotMode && !currentPassword) || (forgotMode && !emailConfirm) || !newPassword || !confirmPassword}
                  className="w-full h-[44px] bg-[#FFA412] text-white text-[14px] font-bold rounded-[10px] transition-all duration-200 hover:bg-[#FFB94A] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-[4px]"
                >
                  {isChangingPassword ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>מעדכן...</span>
                    </>
                  ) : (
                    "עדכן סיסמה"
                  )}
                </Button>
              </form>
            )}
          </div>

          {/* Save Button */}
          {hasChanges && (
            <Button
              type="button"
              onClick={handleSaveProfile}
              disabled={isSaving}
              className="w-full h-[48px] bg-[#FFA412] text-white text-[15px] font-bold rounded-[10px] transition-all duration-200 hover:bg-[#FFB94A] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSaving ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>שומר...</span>
                </>
              ) : (
                "שמור שינויים"
              )}
            </Button>
          )}
        </div>

        {/* Businesses Section */}
        {businesses.length > 0 && (
          <>
            <div className="border-t border-white/10 my-[25px]" />
            <div id="onboarding-settings-businesses">
              <h3 className="text-white text-[16px] font-bold mb-[12px]">עסקים</h3>
              <div className="space-y-[8px]">
                {businesses.map((biz) => (
                  <div
                    key={biz.business_name}
                    className="w-full bg-[#29318A]/20 rounded-[10px] border border-white/5 px-[15px] py-[12px] flex items-center justify-between"
                  >
                    <span className="text-white/70 text-[14px]">{biz.business_name}</span>
                    <span className="text-[12px] text-[#FFA412] bg-[#FFA412]/10 px-[10px] py-[3px] rounded-full">
                      {roleLabels[biz.role] || biz.role}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Push Notifications */}
        <div className="border-t border-white/10 my-[25px]" />
        <div>
          <div className="flex items-center justify-between mb-[4px]">
            <h3 className="text-white text-[16px] font-bold">התראות פוש</h3>
            {isSupported && permission !== 'denied' && (
              <Button
                type="button"
                variant="ghost"
                role="switch"
                aria-checked={isSubscribed}
                aria-label="התראות פוש"
                disabled={pushLoading}
                onClick={async () => {
                  if (isSubscribed) {
                    const ok = await unsubscribe();
                    showToast(ok ? 'התראות פוש בוטלו' : 'שגיאה בביטול התראות', ok ? 'info' : 'error');
                  } else {
                    const ok = await subscribe();
                    showToast(ok ? 'התראות פוש הופעלו!' : 'שגיאה בהפעלת התראות', ok ? 'success' : 'error');
                  }
                }}
                className={`relative w-[52px] h-[28px] rounded-full transition-colors duration-200 p-0 ${pushLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${isSubscribed ? 'bg-[#3CD856]' : 'bg-white/20'}`}
              >
                <span className={`absolute top-[3px] w-[22px] h-[22px] bg-white rounded-full shadow transition-all duration-200 ${isSubscribed ? 'left-[3px]' : 'left-[27px]'}`} />
              </Button>
            )}
          </div>
          <p className="text-white/50 text-[13px]">קבלו התראות גם כשהאפליקציה סגורה</p>
          {!isSupported && (
            <p className="text-white/40 text-[13px] mt-[8px]">הדפדפן אינו תומך בהתראות פוש</p>
          )}
          {isSupported && permission === 'denied' && (
            <p className="text-white/40 text-[13px] mt-[8px]">הרשאת התראות נחסמה. יש לשנות בהגדרות הדפדפן</p>
          )}
        </div>

        {/* WhatsApp Contact Button */}
        <div className="border-t border-white/10 my-[25px]" />
        <a
          href="https://wa.me/972542464081"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full h-[48px] bg-[#25D366] text-white text-[15px] font-bold rounded-[10px] transition-all duration-200 hover:bg-[#20BD5A] active:scale-[0.98] flex items-center justify-center gap-[10px]"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
          </svg>
          <span>יצירת קשר בוואטסאפ</span>
        </a>

        <a
          href="mailto:hello@amazpen.co.il"
          className="w-full h-[48px] bg-[#FFA412] text-white text-[15px] font-bold rounded-[10px] transition-all duration-200 hover:bg-[#FFB94A] active:scale-[0.98] flex items-center justify-center gap-[10px] mt-[10px]"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" strokeLinecap="round" strokeLinejoin="round"/>
            <polyline points="22,6 12,13 2,6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>יצירת קשר במייל</span>
        </a>
        <p className="text-white/40 text-[12px] text-center mt-[6px]">לטיפול מהיר יותר, נא לציין את שם המשתמש, העסק המקושר ותיאור קצר של הפנייה</p>

      </div>
    </div>
  );
}
