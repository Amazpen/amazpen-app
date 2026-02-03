"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Business {
  id: string;
  name: string;
  business_type: string | null;
  logo_url: string | null;
  status: string;
  created_at: string;
}

export default function EditBusinessSelectPage() {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const fetchBusinesses = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setIsLoading(false);
        return;
      }

      // Check if user is admin
      const { data: profile } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", user.id)
        .single();

      const userIsAdmin = profile?.is_admin === true;
      setIsAdmin(userIsAdmin);

      if (!userIsAdmin) {
        setIsLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("businesses")
        .select("id, name, business_type, logo_url, status, created_at")
        .order("name", { ascending: true });

      if (error) {
        console.error("Error fetching businesses:", error);
      } else {
        setBusinesses(data || []);
      }
      setIsLoading(false);
    };

    fetchBusinesses();
  }, []);

  const filteredBusinesses = businesses.filter((business) =>
    business.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelectBusiness = (businessId: string) => {
    router.push(`/admin/business/${businessId}/edit`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-52px)]">
        <div className="animate-spin w-8 h-8 border-4 border-[#4A56D4]/30 border-t-[#4A56D4] rounded-full"></div>
      </div>
    );
  }

  // Only admins can access this page
  if (!isAdmin) {
    return (
      <div dir="rtl" className="flex flex-col items-center justify-center min-h-[calc(100vh-52px)] text-white px-[20px]">
        <div className="w-[80px] h-[80px] rounded-full bg-[#F64E60]/20 flex items-center justify-center mb-[20px]">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" className="text-[#F64E60]">
            <path d="M12 9V13M12 17H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </div>
        <h2 className="text-[20px] font-bold mb-[10px]">אין לך הרשאת ניהול</h2>
        <p className="text-[14px] text-white/60 text-center">רק מנהלי מערכת יכולים לערוך עסקים</p>
      </div>
    );
  }

  return (
    <div dir="rtl" className="flex flex-col min-h-[calc(100vh-52px)] text-white p-[15px]">
      {/* Header */}
      <div className="flex flex-col items-center gap-[10px] mb-[20px]">
        <h1 className="text-[24px] font-bold text-white">עריכת עסק</h1>
        <p className="text-[14px] text-white/60">בחר עסק לעריכה</p>
      </div>

      {/* Search */}
      <div className="mb-[20px]">
        <div className="border border-[#4C526B] rounded-[10px] h-[50px] flex items-center px-[15px] gap-[10px]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-white/50">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2"/>
            <path d="M21 21L16.5 16.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="חיפוש עסק..."
            className="flex-1 bg-transparent text-white text-[14px] text-right border-none outline-none placeholder:text-white/30"
          />
        </div>
      </div>

      {/* Business List */}
      {filteredBusinesses.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-[60px]">
          <svg width="60" height="60" viewBox="0 0 24 24" fill="none" className="text-white/20 mb-[15px]">
            <path d="M19 21V5C19 3.89543 18.1046 3 17 3H7C5.89543 3 5 3.89543 5 5V21M19 21H5M19 21H21M5 21H3M9 7H10M9 11H10M14 7H15M14 11H15M9 21V16C9 15.4477 9.44772 15 10 15H14C14.5523 15 15 15.4477 15 16V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <p className="text-[16px] text-white/50">
            {searchQuery ? "לא נמצאו עסקים" : "אין עסקים במערכת"}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-[10px]">
          {filteredBusinesses.map((business) => (
            <button
              key={business.id}
              type="button"
              onClick={() => handleSelectBusiness(business.id)}
              className="bg-[#29318A]/30 hover:bg-[#29318A]/50 rounded-[15px] p-[15px] transition-all duration-200 text-right"
            >
              <div className="flex items-center gap-[12px]">
                {/* Logo */}
                <div className="w-[50px] h-[50px] rounded-[10px] bg-[#4956D4]/30 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {business.logo_url ? (
                    <img
                      src={business.logo_url}
                      alt={business.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-white/50">
                      <path d="M19 21V5C19 3.89543 18.1046 3 17 3H7C5.89543 3 5 3.89543 5 5V21M19 21H5M19 21H21M5 21H3M9 7H10M9 11H10M14 7H15M14 11H15M9 21V16C9 15.4477 9.44772 15 10 15H14C14.5523 15 15 15.4477 15 16V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <h3 className="text-[16px] font-bold text-white truncate">{business.name}</h3>
                  <div className="flex items-center gap-[8px] mt-[4px]">
                    {business.business_type && (
                      <span className="text-[12px] text-white/50">{business.business_type}</span>
                    )}
                    <span className={`text-[11px] px-[8px] py-[2px] rounded-full ${
                      business.status === "active"
                        ? "bg-[#3CD856]/20 text-[#3CD856]"
                        : "bg-[#F64E60]/20 text-[#F64E60]"
                    }`}>
                      {business.status === "active" ? "פעיל" : "לא פעיל"}
                    </span>
                  </div>
                </div>

                {/* Arrow */}
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-white/30 flex-shrink-0">
                  <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
