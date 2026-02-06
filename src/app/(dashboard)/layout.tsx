"use client";

import { useState, useEffect, createContext, useContext, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ToastProvider } from "@/components/ui/toast";
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";
import { ConsolidatedInvoiceModal } from "@/components/dashboard/ConsolidatedInvoiceModal";

// Context for sharing selected businesses across pages
interface DashboardContextType {
  selectedBusinesses: string[];
  setSelectedBusinesses: React.Dispatch<React.SetStateAction<string[]>>;
  toggleBusiness: (id: string) => void;
  isAdmin: boolean;
  refreshProfile: () => Promise<void>;
}

const DashboardContext = createContext<DashboardContextType>({
  selectedBusinesses: [],
  setSelectedBusinesses: () => {},
  toggleBusiness: () => {},
  isAdmin: false,
  refreshProfile: async () => {},
});

export const useDashboard = () => useContext(DashboardContext);

// Pages that exist (have actual page.tsx files)
const existingPages = ["/", "/expenses", "/suppliers", "/payments", "/goals", "/reports", "/ocr", "/settings", "/ai", "/admin/business/new", "/admin/business/edit", "/admin/users", "/admin/goals"];

// Menu items for sidebar
const menuItems = [
  { id: 1, label: "דשבורד ראשי", href: "/", key: "dashboard" },
  { id: 2, label: "ניהול הוצאות", href: "/expenses", key: "expenses", requiresBusiness: true },
  { id: 3, label: "ניהול ספקים", href: "/suppliers", key: "suppliers", requiresBusiness: true },
  { id: 4, label: "ניהול תשלומים", href: "/payments", key: "payments", requiresBusiness: true },
  { id: 5, label: "תובנות עסקית", href: "/insights", key: "insights", requiresBusiness: true },
  { id: 6, label: "מערכת משימות", href: "/tasks", key: "tasks", requiresBusiness: true },
  { id: 7, label: "דוח רווח הפסד", href: "/reports", key: "reports", requiresBusiness: true },
  { id: 8, label: "יעדים", href: "/goals", key: "goals", requiresBusiness: true },
  { id: 9, label: "סקרים", href: "/surveys", key: "surveys", requiresBusiness: true },
  { id: 10, label: "הגדרות", href: "/settings", key: "settings" },
  { id: 11, label: "התנתקות", href: "#logout", key: "logout", isLogout: true },
];

// Admin menu items - only for admin users
const adminMenuItems = [
  { id: 100, label: "יצירת עסק חדש", href: "/admin/business/new", key: "admin-new-business" },
  { id: 101, label: "עריכת עסק", href: "/admin/business/edit", key: "admin-edit-business" },
  { id: 102, label: "ניהול משתמשים", href: "/admin/users", key: "admin-users" },
  { id: 103, label: "ניהול יעדים ותקציבים", href: "/admin/goals", key: "admin-goals" },
  { id: 104, label: "קליטת מסמכים OCR", href: "/ocr", key: "admin-ocr" },
];

// Page titles mapping
const pageTitles: Record<string, string> = {
  "/": "דשבורד ראשי",
  "/expenses": "ניהול הוצאות",
  "/suppliers": "ניהול ספקים",
  "/payments": "ניהול תשלומים",
  "/ocr": "קליטת מסמכים OCR",
  "/insights": "תובנות עסקית",
  "/tasks": "מערכת משימות",
  "/reports": "דוח רווח הפסד",
  "/goals": "יעדים",
  "/surveys": "סקרים",
  "/settings": "הגדרות",
  "/admin/business/new": "יצירת עסק חדש",
  "/admin/business/edit": "עריכת עסק",
  "/admin/users": "ניהול משתמשים",
  "/admin/goals": "ניהול יעדים ותקציבים",
  "/ai": "עוזר AI",
};

// Menu icon component
const MenuIcon = ({ active }: { active?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className={active ? "text-white" : "text-white/70"}>
    <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/>
    <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/>
    <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/>
    <rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/>
  </svg>
);

// Settings gear icon
const SettingsIcon = ({ active }: { active?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className={active ? "text-white" : "text-white/70"}>
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// Notification type
interface Notification {
  id: number;
  user_id: string;
  title: string;
  message: string | null;
  type: string | null;
  is_read: boolean;
  link: string | null;
  created_at: string;
  business_id: string | null;
}

// User profile type
interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  is_admin?: boolean;
}


export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showBusinessRequiredPopup, setShowBusinessRequiredPopup] = useState(false);
  const [selectedBusinesses, setSelectedBusinesses] = useState<string[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [businessName, setBusinessName] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isCoordinatorModalOpen, setIsCoordinatorModalOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [profileImageLoaded, setProfileImageLoaded] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  // Set mounted state after hydration and restore client-only state
  useEffect(() => {
    // Restore isAdmin from localStorage to avoid flash before profile fetch
    const savedAdmin = localStorage.getItem('isAdmin') === 'true';
    if (savedAdmin) {
      setIsAdmin(true);
    }
    setIsMounted(true);
  }, []);

  // Fetch user profile from Supabase
  const fetchUserProfile = useCallback(async () => {
    setIsLoadingProfile(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      // Get profile from profiles table (including is_admin)
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, email, full_name, avatar_url, is_admin")
        .eq("id", user.id)
        .single();

      if (profile) {
        // Reset image loaded state when avatar changes
        setProfileImageLoaded(prev => {
          if (profile.avatar_url !== userProfile?.avatar_url) return false;
          return prev;
        });
        setUserProfile(profile);
        // Check if user is admin from profile
        const adminStatus = profile.is_admin === true;
        setIsAdmin(adminStatus);
        localStorage.setItem('isAdmin', String(adminStatus));
      }
    }
    setIsLoadingProfile(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isMounted) return;
    fetchUserProfile();
  }, [isMounted, fetchUserProfile]);

  // Fetch business name for sidebar display
  useEffect(() => {
    const fetchBusinessName = async () => {
      if (selectedBusinesses.length === 0) {
        setBusinessName(null);
        return;
      }

      const supabase = createClient();
      const { data: business } = await supabase
        .from("businesses")
        .select("name")
        .eq("id", selectedBusinesses[0])
        .single();

      if (business) {
        setBusinessName(business.name);
      }
    };

    fetchBusinessName();
  }, [selectedBusinesses]);

  // Fetch notifications from Supabase
  const fetchNotifications = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);

      if (!error && data) {
        setNotifications(data);
        setUnreadCount(data.filter(n => !n.is_read).length);
      }
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Global Realtime subscription for all important tables
  useMultiTableRealtime(
    ["notifications", "businesses", "daily_entries", "tasks", "invoices", "payments", "suppliers", "goals"],
    fetchNotifications,
    true
  );

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("selectedBusinesses");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setSelectedBusinesses(parsed);
        }
      } catch {
        // Invalid JSON, ignore
      }
    }
    setIsHydrated(true);
  }, []);

  // Save to localStorage when selectedBusinesses changes
  useEffect(() => {
    if (isHydrated) {
      localStorage.setItem("selectedBusinesses", JSON.stringify(selectedBusinesses));
    }
  }, [selectedBusinesses, isHydrated]);

  const toggleBusiness = (id: string) => {
    setSelectedBusinesses(prev =>
      prev.includes(id)
        ? prev.filter(businessId => businessId !== id)
        : [...prev, id]
    );
  };

  const title = pageTitles[pathname] || "דשבורד";
  const activeKey = menuItems.find(item => item.href === pathname)?.key || "dashboard";

  const handleMenuClick = (item: typeof menuItems[0], e: React.MouseEvent) => {
    if (item.requiresBusiness && selectedBusinesses.length === 0) {
      e.preventDefault();
      setIsMenuOpen(false);
      setShowBusinessRequiredPopup(true);
    } else {
      setIsMenuOpen(false);
    }
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      localStorage.removeItem("selectedBusinesses");
      router.push("/login");
    } catch (error) {
      console.error("Error logging out:", error);
      setIsLoggingOut(false);
    }
  };

  const markNotificationAsRead = async (notificationId: number) => {
    const supabase = createClient();
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", notificationId);

    setNotifications(prev =>
      prev.map(n => n.id === notificationId ? { ...n, is_read: true } : n)
    );
    setUnreadCount(prev => Math.max(0, prev - 1));
  };

  const markAllAsRead = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", user.id)
        .eq("is_read", false);

      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);
    }
  };

  const formatTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "עכשיו";
    if (diffMins < 60) return `לפני ${diffMins} דקות`;
    if (diffHours < 24) return `לפני ${diffHours} שעות`;
    if (diffDays < 7) return `לפני ${diffDays} ימים`;
    return date.toLocaleDateString("he-IL");
  };

  return (
    <ToastProvider>
    <DashboardContext.Provider value={{ selectedBusinesses, setSelectedBusinesses, toggleBusiness, isAdmin, refreshProfile: fetchUserProfile }}>
      <div className="min-h-screen bg-[#0F1535]">
        {/* Sidebar Overlay */}
        {isMenuOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-[1502]"
            onClick={() => setIsMenuOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Sidebar Menu */}
        <nav
          role="navigation"
          aria-label="תפריט ראשי"
          className={`fixed top-0 right-0 h-full w-[50%] max-w-[250px] bg-[#111056] z-[1503] transform transition-transform duration-300 ease-in-out p-[20px] pb-[55px] ${
            isMenuOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <button
            type="button"
            title="סגור תפריט"
            onClick={() => setIsMenuOpen(false)}
            className="absolute top-4 left-4 w-8 h-8 flex items-center justify-center text-white/70 hover:text-white transition-colors"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>

          <div className="flex flex-col h-full overflow-y-auto mt-[40px]">
            {/* Amazpen System Logo - Fixed/Static */}
            <div className="flex justify-center my-[15px]">
              <img
                src="https://ae8ccc76b2d94d531551691b1d6411c9.cdn.bubble.io/cdn-cgi/image/w=192,h=88,f=auto,dpr=2,fit=contain/f1740495696315x242439751655884480/logo%20white.png"
                alt="Amazpen"
                className="w-[143px] h-[66px] object-contain"
              />
            </div>

            {/* Business Name */}
            <div className="flex items-center justify-end gap-[10px] p-[7px] rounded-[10px] mb-[10px]">
              <img
                src="https://ae8ccc76b2d94d531551691b1d6411c9.cdn.bubble.io/f1725470298167x485496868385594050/userlogin.svg"
                alt=""
                className="w-[30px] h-[30px] rounded-[5px]"
              />
              <span className="text-white text-[16px] font-medium text-right flex-1" suppressHydrationWarning>
                {businessName || "עסק"}
              </span>
            </div>

            <div className="flex flex-col gap-[5px]">
              {menuItems.map((item) => {
                // Handle logout button
                if (item.isLogout) {
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={handleLogout}
                      disabled={isLoggingOut}
                      className="flex items-center gap-[10px] p-[7px] rounded-[10px] cursor-pointer transition-all duration-200 opacity-75 hover:bg-[#29318A]/50 hover:opacity-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <div className="w-[21px] h-[21px] flex items-center justify-center flex-shrink-0">
                        <MenuIcon />
                      </div>
                      <span className="text-white text-[14px] font-medium text-right flex-1">
                        {isLoggingOut ? "מתנתק..." : item.label}
                      </span>
                    </button>
                  );
                }

                const pageExists = existingPages.includes(item.href);

                const IconComponent = item.key === "settings" ? SettingsIcon : MenuIcon;

                if (!pageExists) {
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-[10px] p-[7px] rounded-[10px] opacity-30 cursor-not-allowed"
                    >
                      <div className="w-[21px] h-[21px] flex items-center justify-center flex-shrink-0">
                        <IconComponent />
                      </div>
                      <span className="text-white text-[14px] font-medium text-right flex-1">{item.label}</span>
                    </div>
                  );
                }

                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    onClick={(e) => handleMenuClick(item, e)}
                    className={`flex items-center gap-[10px] p-[7px] rounded-[10px] cursor-pointer transition-all duration-200 ${
                      activeKey === item.key
                        ? 'bg-[#29318A] opacity-100'
                        : 'opacity-75 hover:bg-[#29318A]/50 hover:opacity-100'
                    }`}
                  >
                    <div className="w-[21px] h-[21px] flex items-center justify-center flex-shrink-0">
                      <IconComponent active={activeKey === item.key} />
                    </div>
                    <span className="text-white text-[14px] font-medium text-right flex-1">{item.label}</span>
                  </Link>
                );
              })}
            </div>

            {/* Admin Section - Show only for admin users */}
            {isAdmin && (
            <div className="mt-[20px] pt-[15px] border-t border-white/10">
              <div className="flex items-center gap-[8px] mb-[10px] px-[7px]">
                <span className="text-[#FFA412] text-[12px] font-bold">ניהול מערכת</span>
              </div>
              {adminMenuItems.map((item) => {
                const pageExists = existingPages.includes(item.href);

                if (!pageExists) {
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-[10px] p-[7px] rounded-[10px] opacity-30 cursor-not-allowed"
                    >
                      <div className="w-[21px] h-[21px] flex items-center justify-center flex-shrink-0">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-white/70">
                          <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        </svg>
                      </div>
                      <span className="text-white text-[14px] font-medium text-right flex-1">{item.label}</span>
                    </div>
                  );
                }

                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    onClick={() => setIsMenuOpen(false)}
                    className={`flex items-center gap-[10px] p-[7px] rounded-[10px] cursor-pointer transition-all duration-200 ${
                      activeKey === item.key
                        ? 'bg-[#FFA412]/20 opacity-100'
                        : 'opacity-75 hover:bg-[#FFA412]/10 hover:opacity-100'
                    }`}
                  >
                    <div className="w-[21px] h-[21px] flex items-center justify-center flex-shrink-0">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className={activeKey === item.key ? "text-[#FFA412]" : "text-white/70"}>
                        <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    </div>
                    <span className={`text-[14px] font-medium text-right flex-1 ${activeKey === item.key ? "text-[#FFA412]" : "text-white"}`}>{item.label}</span>
                  </Link>
                );
              })}
            </div>
            )}

          </div>
        </nav>

        {/* Business Required Popup */}
        {showBusinessRequiredPopup && (
          <>
            <div
              className="fixed inset-0 bg-black/50 z-[2001]"
              onClick={() => setShowBusinessRequiredPopup(false)}
            />
            <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-40px)] max-w-[380px] bg-[#29318A] rounded-[15px] p-[25px] z-[2002] shadow-[0_10px_40px_rgba(0,0,0,0.5)] border border-white/5">
              <div className="flex flex-col items-center justify-center gap-[20px]">
                {/* Icon */}
                <div className="w-[60px] h-[60px] rounded-full bg-[#0F1535] flex items-center justify-center">
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#FFA412" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 8v4M12 16h.01"/>
                  </svg>
                </div>

                {/* Text */}
                <p className="text-white text-[18px] font-bold text-center leading-[1.5]">
                  יש לבחור עסק אחד לפחות במסך דשבורד
                </p>

                {/* Button */}
                <button
                  type="button"
                  onClick={() => setShowBusinessRequiredPopup(false)}
                  className="bg-[#0F1535] text-white text-[14px] font-semibold px-[30px] py-[12px] rounded-[10px] transition-all duration-200 hover:bg-[#1a1f4a] active:scale-[0.98]"
                >
                  חזרה למסך דשבורד
                </button>
              </div>
            </div>
          </>
        )}

        {/* Fixed Header - Always visible */}
        <header role="banner" aria-label="כותרת עליונה" className="fixed top-0 left-0 right-0 z-50 bg-[#0f1231] flex justify-between items-center px-3 sm:px-4 py-3 sm:py-3 min-h-[60px] sm:min-h-[56px]">
          {/* Right side - Menu and Title */}
          <div className="flex items-center gap-[8px]">
            <button
              type="button"
              aria-label="תפריט"
              title="תפריט"
              onClick={() => setIsMenuOpen(true)}
              className="w-[44px] h-[44px] sm:w-[40px] sm:h-[40px] flex items-center justify-center text-[#4C526B] cursor-pointer touch-manipulation"
            >
              <svg width="30" height="30" viewBox="0 0 32 32" fill="none" className="sm:w-8 sm:h-8">
                <path d="M5 8H27M5 16H27M5 24H27" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
            <span className="text-white text-[17px] sm:text-[19px] font-bold leading-[1.4]">{title}</span>
          </div>

          {/* Left side - Profile, Notifications, Buttons */}
          <div className="flex flex-row-reverse items-center gap-2 sm:gap-[5px]">
            {/* Profile Image */}
            <div className="w-[34px] h-[34px] sm:w-[32px] sm:h-[32px] rounded-full overflow-hidden border border-[#4C526B] bg-[#29318A] flex items-center justify-center relative touch-manipulation" suppressHydrationWarning>
              {/* Skeleton loader - only show when loading AND there's an image to load */}
              {(isLoadingProfile || (!profileImageLoaded && userProfile?.avatar_url)) && (
                <div className="absolute inset-0 bg-gradient-to-r from-[#29318A] via-[#3D44A0] to-[#29318A] animate-pulse rounded-full" />
              )}
              {userProfile?.avatar_url && (
                <img
                  src={userProfile.avatar_url}
                  alt="Profile"
                  className={`w-full h-full object-cover transition-opacity duration-300 ${profileImageLoaded ? 'opacity-100' : 'opacity-0'}`}
                  onLoad={() => setProfileImageLoaded(true)}
                  onError={() => setProfileImageLoaded(true)}
                />
              )}
              {!isLoadingProfile && !userProfile?.avatar_url && (
                /* User icon when no avatar */
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="sm:w-[18px] sm:h-[18px]">
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" strokeLinecap="round" strokeLinejoin="round"/>
                  <circle cx="12" cy="7" r="4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>

            {/* Notifications with red dot */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
                className="w-[34px] h-[34px] sm:w-[32px] sm:h-[32px] rounded-full bg-[#29318A] flex items-center justify-center relative cursor-pointer hover:bg-[#3D44A0] transition-colors touch-manipulation"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="sm:w-[20px] sm:h-[20px] text-[#FFA412]">
                  <path d="M18 8C18 6.4087 17.3679 4.88258 16.2426 3.75736C15.1174 2.63214 13.5913 2 12 2C10.4087 2 8.88258 2.63214 7.75736 3.75736C6.63214 4.88258 6 6.4087 6 8C6 15 3 17 3 17H21C21 17 18 15 18 8Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M13.73 21C13.5542 21.3031 13.3019 21.5547 12.9982 21.7295C12.6946 21.9044 12.3504 21.9965 12 21.9965C11.6496 21.9965 11.3054 21.9044 11.0018 21.7295C10.6982 21.5547 10.4458 21.3031 10.27 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                {/* Notification red dot - only show if unread */}
                {unreadCount > 0 && (
                  <div className="absolute top-[5px] right-[8px] w-[10px] h-[10px] bg-[#EB5757] rounded-full"></div>
                )}
              </button>

              {/* Notifications Dropdown - Facebox Style - Full Width */}
              {isNotificationsOpen && (
                <>
                  {/* Overlay to close dropdown */}
                  <div
                    className="fixed inset-0 z-[99]"
                    onClick={() => setIsNotificationsOpen(false)}
                  />
                  {/* Dropdown - Full width */}
                  <div
                    dir="rtl"
                    className="fixed top-[60px] sm:top-[56px] left-0 right-0 w-full max-h-[70vh] bg-[#111056] shadow-[0_10px_40px_rgba(0,0,0,0.5)] border-b border-white/10 z-[100] overflow-hidden"
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between p-[15px] border-b border-white/10">
                      <div className="flex items-center gap-[10px]">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-[#FFA412]">
                          <path d="M18 8C18 6.4087 17.3679 4.88258 16.2426 3.75736C15.1174 2.63214 13.5913 2 12 2C10.4087 2 8.88258 2.63214 7.75736 3.75736C6.63214 4.88258 6 6.4087 6 8C6 15 3 17 3 17H21C21 17 18 15 18 8Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                          <path d="M13.73 21C13.5542 21.3031 13.3019 21.5547 12.9982 21.7295C12.6946 21.9044 12.3504 21.9965 12 21.9965C11.6496 21.9965 11.3054 21.9044 11.0018 21.7295C10.6982 21.5547 10.4458 21.3031 10.27 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        </svg>
                        <span className="text-white text-[16px] font-bold">התראות</span>
                        {unreadCount > 0 && (
                          <span className="bg-[#EB5757] text-white text-[11px] font-bold px-[8px] py-[2px] rounded-full">
                            {unreadCount}
                          </span>
                        )}
                      </div>
                      {unreadCount > 0 && (
                        <button
                          type="button"
                          onClick={markAllAsRead}
                          className="text-[12px] text-[#FFA412] hover:text-[#FFB94A] transition-colors"
                        >
                          סמן הכל כנקרא
                        </button>
                      )}
                    </div>

                    {/* Notifications List */}
                    <div className="max-h-[calc(70vh-60px)] overflow-y-auto">
                      {notifications.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-[40px] px-[20px]">
                          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-white/20 mb-[15px]">
                            <path d="M18 8C18 6.4087 17.3679 4.88258 16.2426 3.75736C15.1174 2.63214 13.5913 2 12 2C10.4087 2 8.88258 2.63214 7.75736 3.75736C6.63214 4.88258 6 6.4087 6 8C6 15 3 17 3 17H21C21 17 18 15 18 8Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                            <path d="M13.73 21C13.5542 21.3031 13.3019 21.5547 12.9982 21.7295C12.6946 21.9044 12.3504 21.9965 12 21.9965C11.6496 21.9965 11.3054 21.9044 11.0018 21.7295C10.6982 21.5547 10.4458 21.3031 10.27 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                          </svg>
                          <p className="text-white/50 text-[14px]">אין התראות חדשות</p>
                        </div>
                      ) : (
                        notifications.map((notification) => (
                          <div
                            key={notification.id}
                            onClick={() => {
                              if (!notification.is_read) {
                                markNotificationAsRead(notification.id);
                              }
                              if (notification.link) {
                                router.push(notification.link);
                                setIsNotificationsOpen(false);
                              }
                            }}
                            className={`flex gap-[12px] p-[15px] border-b border-white/5 cursor-pointer transition-colors ${
                              notification.is_read
                                ? "bg-transparent hover:bg-white/5"
                                : "bg-[#29318A]/30 hover:bg-[#29318A]/50"
                            }`}
                          >
                            {/* Icon based on type */}
                            <div className={`w-[40px] h-[40px] rounded-full flex items-center justify-center flex-shrink-0 ${
                              notification.type === "success" ? "bg-[#3CD856]/20" :
                              notification.type === "warning" ? "bg-[#FFA412]/20" :
                              notification.type === "error" ? "bg-[#EB5757]/20" :
                              "bg-[#29318A]"
                            }`}>
                              {notification.type === "success" ? (
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-[#3CD856]">
                                  <path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              ) : notification.type === "warning" ? (
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-[#FFA412]">
                                  <path d="M12 9V13M12 17H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                </svg>
                              ) : notification.type === "error" ? (
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-[#EB5757]">
                                  <path d="M12 8V12M12 16H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                </svg>
                              ) : (
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-[#FFA412]">
                                  <path d="M18 8C18 6.4087 17.3679 4.88258 16.2426 3.75736C15.1174 2.63214 13.5913 2 12 2C10.4087 2 8.88258 2.63214 7.75736 3.75736C6.63214 4.88258 6 6.4087 6 8C6 15 3 17 3 17H21C21 17 18 15 18 8Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                </svg>
                              )}
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-[10px]">
                                <p className={`text-[14px] font-medium leading-[1.4] ${notification.is_read ? "text-white/70" : "text-white"}`}>
                                  {notification.title}
                                </p>
                                {!notification.is_read && (
                                  <div className="w-[8px] h-[8px] bg-[#FFA412] rounded-full flex-shrink-0 mt-[6px]"></div>
                                )}
                              </div>
                              {notification.message && (
                                <p className="text-[12px] text-white/50 leading-[1.4] mt-[4px] line-clamp-2">
                                  {notification.message}
                                </p>
                              )}
                              <p className="text-[11px] text-white/30 mt-[6px]" suppressHydrationWarning>
                                {formatTimeAgo(notification.created_at)}
                              </p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* AI Button */}
            <Link href="/ai" className="px-[8px] sm:px-[12px] py-[4px] sm:py-[3px] h-[34px] sm:h-auto min-w-[50px] sm:min-w-[60px] text-center bg-[#29318A] rounded-[7px] text-white text-[12px] sm:text-[13px] font-bold leading-[1.4] cursor-pointer hover:bg-[#3D44A0] transition-colors touch-manipulation flex items-center justify-center">
              AI
            </Link>

            {/* מרכזת Button - Admin Only */}
            {isAdmin && (
              <button
                type="button"
                onClick={() => setIsCoordinatorModalOpen(true)}
                className="px-[8px] sm:px-[12px] py-[4px] sm:py-[3px] h-[34px] sm:h-auto min-w-[50px] sm:min-w-[60px] text-center bg-[#29318A] rounded-[7px] text-white text-[12px] sm:text-[13px] font-bold leading-[1.4] cursor-pointer hover:bg-[#3D44A0] transition-colors touch-manipulation"
              >
                מרכזת
              </button>
            )}
          </div>
        </header>

        {/* Main Content - with top padding for fixed header */}
        <main role="main" aria-label="תוכן ראשי" className="pt-[60px] sm:pt-[56px]">
          {children}
        </main>

        {/* Coordinator Modal - Admin Only */}
        {isAdmin && (
          <ConsolidatedInvoiceModal
            isOpen={isCoordinatorModalOpen}
            onClose={() => setIsCoordinatorModalOpen(false)}
          />
        )}
      </div>
    </DashboardContext.Provider>
    </ToastProvider>
  );
}
