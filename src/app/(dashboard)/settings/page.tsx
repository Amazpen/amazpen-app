"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { uploadFile } from "@/lib/uploadFile";
import { useToast } from "@/components/ui/toast";

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
}

export default function SettingsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [fullName, setFullName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

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
        .select("id, email, full_name, phone, avatar_url")
        .eq("id", user.id)
        .single();

      if (profileData) {
        setProfile(profileData);
        setFullName(profileData.full_name || "");
        setAvatarUrl(profileData.avatar_url);
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
        updated_at: new Date().toISOString(),
      })
      .eq("id", profile.id);

    if (error) {
      showToast("שגיאה בשמירת הפרופיל", "error");
    } else {
      setProfile(prev => prev ? { ...prev, full_name: fullName.trim() || null } : null);
      showToast("הפרופיל עודכן בהצלחה", "success");
    }

    setIsSaving(false);
  };

  const displayAvatar = avatarPreview || avatarUrl;
  const hasNameChanged = fullName.trim() !== (profile?.full_name || "");

  if (isLoading) {
    return (
      <div dir="rtl" className="p-4 sm:p-6">
        <div className="max-w-[500px] mx-auto space-y-6">
          {/* Skeleton loader */}
          <div className="flex flex-col items-center gap-4">
            <div className="w-[100px] h-[100px] rounded-full bg-[#29318A] animate-pulse" />
            <div className="h-5 w-32 bg-[#29318A] rounded animate-pulse" />
          </div>
          <div className="space-y-4">
            <div className="h-12 bg-[#29318A] rounded-[10px] animate-pulse" />
            <div className="h-12 bg-[#29318A] rounded-[10px] animate-pulse" />
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

          {/* Email (read-only) */}
          <div className="flex flex-col gap-[8px]">
            <label className="text-[14px] font-medium text-white/80">אימייל</label>
            <div className="w-full h-[48px] bg-[#29318A]/20 text-white/50 text-[14px] text-right rounded-[10px] border border-white/5 px-[15px] flex items-center">
              {profile?.email}
            </div>
          </div>

          {/* Save Name Button */}
          {hasNameChanged && (
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

      </div>
    </div>
  );
}
