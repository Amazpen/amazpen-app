"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LogoutPage() {
  const router = useRouter();

  useEffect(() => {
    const handleLogout = async () => {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/login");
      router.refresh();
    };

    handleLogout();
  }, [router]);

  return (
    <div
      dir="rtl"
      className="min-h-screen flex flex-col items-center justify-center bg-[#0F1231]"
    >
      <div className="flex flex-col items-center gap-[20px]">
        <div className="animate-spin w-8 h-8 border-4 border-[#29318A]/30 border-t-[#29318A] rounded-full"></div>
        <p className="text-white text-[16px]">מתנתק...</p>
      </div>
    </div>
  );
}
