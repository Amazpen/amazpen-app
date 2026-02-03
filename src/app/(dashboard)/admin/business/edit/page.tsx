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
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const fetchBusinesses = async () => {
      const supabase = createClient();
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
      {isLoading ? (
        <div className="flex flex-col gap-[10px]">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-[#29318A]/30 rounded-[15px] p-[15px] animate-pulse">
              <div className="flex items-center gap-[12px]">
                <div className="w-[50px] h-[50px] rounded-[10px] bg-[#4C526B]/50" />
                <div className="flex-1">
                  <div className="h-[18px] bg-[#4C526B]/50 rounded w-[60%] mb-[8px]" />
                  <div className="h-[14px] bg-[#4C526B]/30 rounded w-[40%]" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : filteredBusinesses.length === 0 ? (
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
