"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { uploadFile } from "@/lib/uploadFile";
import { useToast } from "@/components/ui/toast";
import { useDashboard } from "../layout";

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

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
        <div className="flex flex-col items-center mb-[30px]">
          <div className="relative group mb-[12px]">
            <div className="w-[100px] h-[100px] rounded-full overflow-hidden border-[3px] border-[#29318A] bg-[#29318A] flex items-center justify-center">
              {displayAvatar ? (
                <img
                  src={displayAvatar}
                  alt="תמונת פרופיל"
                  className="w-full h-full object-cover"
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
            <button
              type="button"
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
            </button>

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
            <input
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
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="הזן מספר טלפון..."
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

          {/* Save Button */}
          {hasChanges && (
            <button
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
            </button>
          )}
        </div>

        {/* Businesses Section */}
        {businesses.length > 0 && (
          <>
            <div className="border-t border-white/10 my-[25px]" />
            <div>
              <h3 className="text-white text-[16px] font-bold mb-[12px]">עסקים</h3>
              <div className="space-y-[8px]">
                {businesses.map((biz, idx) => (
                  <div
                    key={idx}
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
