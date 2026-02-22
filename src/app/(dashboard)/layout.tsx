"use client";

import { useState, useEffect, createContext, useContext, useCallback, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ToastProvider } from "@/components/ui/toast";
import { InstallPrompt } from "@/components/ui/install-prompt";
import { UpdatePrompt } from "@/components/ui/update-prompt";
import { PushPrompt } from "@/components/ui/push-prompt";
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";
import { ConsolidatedInvoiceModal } from "@/components/dashboard/ConsolidatedInvoiceModal";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { useWakeLock } from "@/hooks/useWakeLock";
import { OfflineIndicator } from "@/components/ui/offline-indicator";
import { Button } from "@/components/ui/button";
// import { OnboardingProvider } from "@/components/onboarding/OnboardingProvider";
// import { HelpButton } from "@/components/onboarding/HelpButton";

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
const existingPages = ["/", "/customers", "/expenses", "/suppliers", "/payments", "/cashflow", "/goals", "/reports", "/insights", "/ocr", "/price-tracking", "/settings", "/ai", "/admin/business/new", "/admin/business/edit", "/admin/users", "/admin/goals", "/admin/suppliers", "/admin/expenses", "/admin/payments", "/admin/daily-entries", "/admin/historical-data"];

// Menu items for sidebar
const menuItems = [
  { id: 1, label: "דשבורד ראשי", href: "/", key: "dashboard" },
  { id: 12, label: "ניהול לקוחות ונותני שירות", href: "/customers", key: "customers", requiresBusiness: true },
  { id: 2, label: "ניהול הוצאות", href: "/expenses", key: "expenses", requiresBusiness: true },
  { id: 3, label: "ניהול ספקים", href: "/suppliers", key: "suppliers", requiresBusiness: true },
  { id: 4, label: "ניהול תשלומים", href: "/payments", key: "payments", requiresBusiness: true },
  { id: 5, label: "תזרים מזומנים", href: "/cashflow", key: "cashflow", requiresBusiness: true },
  { id: 7, label: "דוח רווח הפסד", href: "/reports", key: "reports", requiresBusiness: true },
  { id: 8, label: "יעדים", href: "/goals", key: "goals", requiresBusiness: true },
  { id: 9, label: "תובנות", href: "/insights", key: "insights", requiresBusiness: true },
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
  { id: 108, label: "מעקב מחירי ספקים", href: "/price-tracking", key: "admin-price-tracking" },
  { id: 105, label: "ייבוא ספקים", href: "/admin/suppliers", key: "admin-suppliers" },
  { id: 106, label: "ייבוא הוצאות", href: "/admin/expenses", key: "admin-expenses" },
  { id: 107, label: "ייבוא תשלומים", href: "/admin/payments", key: "admin-payments" },
  { id: 109, label: "ייבוא מילוי יומי", href: "/admin/daily-entries", key: "admin-daily-entries" },
  { id: 110, label: "ייבוא נתוני עבר", href: "/admin/historical-data", key: "admin-historical-data" },
];

// Page titles mapping
const pageTitles: Record<string, string> = {
  "/": "דשבורד ראשי",
  "/customers": "ניהול לקוחות ונותני שירות",
  "/expenses": "ניהול הוצאות",
  "/suppliers": "ניהול ספקים",
  "/payments": "ניהול תשלומים",
  "/cashflow": "תזרים מזומנים",
  "/ocr": "קליטת מסמכים OCR",
  "/reports": "דוח רווח הפסד",
  "/goals": "יעדים",
  "/insights": "תובנות",
  "/settings": "הגדרות",
  "/admin/business/new": "יצירת עסק חדש",
  "/admin/business/edit": "עריכת עסק",
  "/admin/users": "ניהול משתמשים",
  "/admin/goals": "ניהול יעדים ותקציבים",
  "/admin/suppliers": "ייבוא ספקים",
  "/admin/expenses": "ייבוא הוצאות",
  "/admin/payments": "ייבוא תשלומים",
  "/admin/daily-entries": "ייבוא מילוי יומי",
  "/admin/historical-data": "ייבוא נתוני עבר",
  "/price-tracking": "מעקב מחירי ספקים",
  "/ai": "עוזר AI",
};

// Dashboard icon component
import {
  ChartPieSlice,
  Receipt as ReceiptIcon,
  ListChecks,
  LightbulbFilament,
  PresentationChart as PresentationChartIcon,
  ClipboardText,
  Trophy as TrophyIcon,
  Wallet as WalletIcon,
  ArrowsLeftRight as ArrowsLeftRightIcon,
  Package as PackageIcon,
  SignOut,
  SquaresFour,
  GearSix,
  UsersThree,
} from "@phosphor-icons/react";

const PhosphorSidebarIcon = ({ Icon, active }: { Icon: React.ElementType; active?: boolean }) => (
  <Icon size={18} weight="duotone" color={active ? "white" : "rgba(255,255,255,0.7)"} />
);

const DashboardIcon = ({ active }: { active?: boolean }) => <PhosphorSidebarIcon Icon={ChartPieSlice} active={active} />;
const ExpensesIcon = ({ active }: { active?: boolean }) => <PhosphorSidebarIcon Icon={ReceiptIcon} active={active} />;
const TasksIcon = ({ active }: { active?: boolean }) => <PhosphorSidebarIcon Icon={ListChecks} active={active} />;
const InsightsIcon = ({ active }: { active?: boolean }) => <PhosphorSidebarIcon Icon={LightbulbFilament} active={active} />;
const ReportsIcon = ({ active }: { active?: boolean }) => <PhosphorSidebarIcon Icon={PresentationChartIcon} active={active} />;
const SurveysIcon = ({ active }: { active?: boolean }) => <PhosphorSidebarIcon Icon={ClipboardText} active={active} />;
const GoalsIcon = ({ active }: { active?: boolean }) => <PhosphorSidebarIcon Icon={TrophyIcon} active={active} />;
const PaymentsIcon = ({ active }: { active?: boolean }) => <PhosphorSidebarIcon Icon={WalletIcon} active={active} />;
const CashFlowIcon = ({ active }: { active?: boolean }) => <PhosphorSidebarIcon Icon={ArrowsLeftRightIcon} active={active} />;
const SuppliersIcon = ({ active }: { active?: boolean }) => <PhosphorSidebarIcon Icon={PackageIcon} active={active} />;
const LogoutIcon = ({ active }: { active?: boolean }) => <PhosphorSidebarIcon Icon={SignOut} active={active} />;
const MenuIcon = ({ active }: { active?: boolean }) => <PhosphorSidebarIcon Icon={SquaresFour} active={active} />;
const SettingsIcon = ({ active }: { active?: boolean }) => <PhosphorSidebarIcon Icon={GearSix} active={active} />;
const CustomersIcon = ({ active }: { active?: boolean }) => <PhosphorSidebarIcon Icon={UsersThree} active={active} />;

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
  const [isAdminMenuOpen, setIsAdminMenuOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [businessName, setBusinessName] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isCoordinatorModalOpen, setIsCoordinatorModalOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const prevUnreadCount = useRef(-1);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [profileImageLoaded, setProfileImageLoaded] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  // Offline sync
  const offlineSync = useOfflineSync();

  // Keep screen awake while app is visible
  useWakeLock();

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
        // Reset image loaded state only when avatar URL actually changes
        if (userProfile && profile.avatar_url !== userProfile.avatar_url) {
          setProfileImageLoaded(false);
        }
        setUserProfile(profile);
        // Check if user is admin from profile
        const adminStatus = profile.is_admin === true;
        setIsAdmin(adminStatus);
        localStorage.setItem('isAdmin', String(adminStatus));

        // For non-admin users: check if all their businesses are inactive
        if (!adminStatus) {
          const { data: memberships } = await supabase
            .from("business_members")
            .select("business_id")
            .eq("user_id", user.id)
            .is("deleted_at", null);

          if (memberships && memberships.length > 0) {
            const bizIds = memberships.map((m) => m.business_id);
            const { data: activeBusinesses } = await supabase
              .from("businesses")
              .select("id")
              .in("id", bizIds)
              .eq("status", "active")
              .is("deleted_at", null)
              .limit(1);

            // If no active businesses found, sign out the user
            if (!activeBusinesses || activeBusinesses.length === 0) {
              await supabase.auth.signOut();
              window.location.href = "/login?error=business_inactive";
              return;
            }
          }
        }
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

  // One-time AI agent "דדי" welcome notification
  useEffect(() => {
    const sendAiWelcomeNotification = async () => {
      if (localStorage.getItem("ai_welcome_notification_sent") === "true") return;

      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Check if this user already has an AI welcome notification
      const { data: existing } = await supabase
        .from("notifications")
        .select("id")
        .eq("user_id", user.id)
        .eq("title", "הכירו את דדי — הסוכן החכם של המצפן")
        .maybeSingle();

      if (existing) {
        localStorage.setItem("ai_welcome_notification_sent", "true");
        return;
      }

      await supabase.from("notifications").insert({
        user_id: user.id,
        title: "הכירו את דדי — הסוכן החכם של המצפן",
        message: "דדי יכול לנתח נתונים עסקיים, להציג טבלאות וגרפים, לעזור בתכנון תקציב ולענות על כל שאלה. נסו עכשיו!",
        type: "info",
        is_read: false,
        link: "/ai",
      });

      localStorage.setItem("ai_welcome_notification_sent", "true");
      fetchNotifications();
    };

    if (isMounted) {
      sendAiWelcomeNotification();
    }
  }, [isMounted, fetchNotifications]);

  // Global Realtime subscription for all important tables
  useMultiTableRealtime(
    ["notifications", "businesses", "daily_entries", "tasks", "invoices", "payments", "suppliers", "goals"],
    fetchNotifications,
    true
  );

  // Re-check business access when businesses table changes (for non-admin users)
  useEffect(() => {
    if (!isMounted || isAdmin) return;
    const supabase = createClient();
    const channel = supabase
      .channel("business-status-check")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "businesses" },
        () => {
          // Re-run profile check which includes business status validation
          fetchUserProfile();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isMounted, isAdmin, fetchUserProfile]);

  // Lazily create AudioContext only after user interaction
  const audioCtxRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    const initAudio = () => {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
    };
    document.addEventListener('click', initAudio, { once: true });
    return () => document.removeEventListener('click', initAudio);
  }, []);

  // Play notification sound when new unread notifications arrive
  useEffect(() => {
    if (unreadCount > prevUnreadCount.current && prevUnreadCount.current > -1) {
      try {
        const ctx = audioCtxRef.current;
        if (!ctx) { prevUnreadCount.current = unreadCount; return; }
        const play = () => {
          [0, 0.15].forEach(offset => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.value = 830;
            gain.gain.setValueAtTime(0.3, ctx.currentTime + offset);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.12);
            osc.start(ctx.currentTime + offset);
            osc.stop(ctx.currentTime + offset + 0.12);
          });
        };
        if (ctx.state === 'suspended') {
          ctx.resume().then(play);
        } else {
          play();
        }
      } catch {
        // Audio not supported
      }
    }
    prevUnreadCount.current = unreadCount;
  }, [unreadCount]);

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
  const isAdminPage = adminMenuItems.some(item => pathname.startsWith(item.href));
  const isOcrPage = pathname === '/ocr';

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

  const deleteNotification = async (notificationId: number) => {
    const supabase = createClient();
    await supabase
      .from("notifications")
      .delete()
      .eq("id", notificationId);

    setNotifications(prev => {
      const deleted = prev.find(n => n.id === notificationId);
      if (deleted && !deleted.is_read) {
        setUnreadCount(c => Math.max(0, c - 1));
      }
      return prev.filter(n => n.id !== notificationId);
    });
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
        {/* Sidebar Overlay - Mobile only */}
        {isMenuOpen && (
          <div
            className={`fixed inset-0 bg-black/50 z-[1502] ${isOcrPage ? '' : 'lg:hidden'}`}
            onClick={() => setIsMenuOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Sidebar Menu - Slide-in on mobile, permanent on desktop */}
        <nav
          aria-label="תפריט ראשי"
          className={`fixed top-0 right-0 h-full w-[50%] max-w-[250px] bg-[#111056] z-[1503] transform transition-transform duration-300 ease-in-out p-[20px] pb-[55px] ${isOcrPage ? '' : 'lg:translate-x-0'} lg:w-[220px] lg:max-w-none lg:shadow-lg ${
            isMenuOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <Button
            type="button"
            title="סגור תפריט"
            onClick={() => setIsMenuOpen(false)}
            className={`absolute top-4 left-4 w-8 h-8 flex items-center justify-center text-white/70 hover:text-white transition-colors ${isOcrPage ? '' : 'lg:hidden'}`}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </Button>

          <div className="flex flex-col h-full overflow-y-auto mt-[40px] lg:mt-[10px]">
            {/* Amazpen System Logo - Fixed/Static */}
            <div className="flex justify-center my-[15px]">
              <Image
                src="https://ae8ccc76b2d94d531551691b1d6411c9.cdn.bubble.io/cdn-cgi/image/w=192,h=88,f=auto,dpr=2,fit=contain/f1740495696315x242439751655884480/logo%20white.png"
                alt="Amazpen"
                className="w-[143px] h-[66px] object-contain"
                width={143}
                height={66}
                unoptimized
                priority
                loading="eager"
              />
            </div>

            {/* Business Name */}
            <div className="flex items-center justify-end gap-[10px] p-[7px] rounded-[10px] mb-[10px]">
              <Image
                src="https://ae8ccc76b2d94d531551691b1d6411c9.cdn.bubble.io/f1725470298167x485496868385594050/userlogin.svg"
                alt=""
                className="w-[30px] h-[30px] rounded-[5px]"
                width={30}
                height={30}
                unoptimized
                priority
                loading="eager"
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
                    <Button
                      key={item.id}
                      type="button"
                      onClick={handleLogout}
                      disabled={isLoggingOut}
                      className="flex items-center gap-[10px] p-[7px] rounded-[10px] cursor-pointer transition-all duration-200 opacity-75 hover:bg-[#29318A]/50 hover:opacity-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <div className="w-[21px] h-[21px] flex items-center justify-center flex-shrink-0">
                        <LogoutIcon />
                      </div>
                      <span className="text-white text-[14px] font-medium text-right flex-1">
                        {isLoggingOut ? "מתנתק..." : item.label}
                      </span>
                    </Button>
                  );
                }

                const pageExists = existingPages.includes(item.href);

                const IconComponent = item.key === "settings" ? SettingsIcon : item.key === "dashboard" ? DashboardIcon : item.key === "expenses" ? ExpensesIcon : item.key === "suppliers" ? SuppliersIcon : item.key === "payments" ? PaymentsIcon : item.key === "cashflow" ? CashFlowIcon : item.key === "insights" ? InsightsIcon : item.key === "tasks" ? TasksIcon : item.key === "reports" ? ReportsIcon : item.key === "goals" ? GoalsIcon : item.key === "surveys" ? SurveysIcon : item.key === "customers" ? CustomersIcon : MenuIcon;

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

            {/* Admin Section - Collapsible, show only for admin users */}
            {isAdmin && (
            <div className="mt-[20px] pt-[15px] border-t border-white/10">
              <Button
                type="button"
                onClick={() => setIsAdminMenuOpen((prev) => !prev)}
                className="flex items-center justify-between w-full px-[7px] mb-[4px] cursor-pointer group"
              >
                <div className="flex items-center gap-[8px]">
                  <span className="text-[#FFA412] text-[12px] font-bold">ניהול מערכת</span>
                </div>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  className={`text-[#FFA412] transition-transform duration-200 ${isAdminMenuOpen || isAdminPage ? 'rotate-180' : ''}`}
                >
                  <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </Button>
              <div className={`overflow-hidden transition-all duration-200 ${isAdminMenuOpen || isAdminPage ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}>
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
                <Button
                  type="button"
                  onClick={() => setShowBusinessRequiredPopup(false)}
                  className="bg-[#0F1535] text-white text-[14px] font-semibold px-[30px] py-[12px] rounded-[10px] transition-all duration-200 hover:bg-[#1a1f4a] active:scale-[0.98]"
                >
                  חזרה למסך דשבורד
                </Button>
              </div>
            </div>
          </>
        )}

        {/* Fixed Header - Always visible, offset by sidebar on desktop */}
        <header role="banner" aria-label="כותרת עליונה" className={`fixed top-0 left-0 right-0 ${isOcrPage ? '' : 'lg:right-[220px]'} z-50 bg-[#0f1231] flex justify-between items-center px-[7px] sm:px-3 py-3 sm:py-3 min-h-[60px] sm:min-h-[56px]`}>
          {/* Right side - Menu and Title */}
          <div className="flex items-center gap-[8px]">
            <Button
              type="button"
              aria-label="תפריט"
              title="תפריט"
              onClick={() => setIsMenuOpen(true)}
              className={`w-[44px] h-[44px] sm:w-[40px] sm:h-[40px] flex items-center justify-center text-[#4C526B] cursor-pointer touch-manipulation ${isOcrPage ? '' : 'lg:hidden'}`}
            >
              <svg width="30" height="30" viewBox="0 0 32 32" fill="none" className="sm:w-8 sm:h-8">
                <path d="M5 8H27M5 16H27M5 24H27" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </Button>
            <span className="text-white text-[17px] sm:text-[19px] font-bold leading-[1.4]">{title}</span>
          </div>

          {/* Left side - Profile, Notifications, Buttons */}
          <div className="flex flex-row-reverse items-stretch gap-2 sm:gap-[5px]">
            {/* Profile Image */}
            <Link href="/settings" className="w-[34px] sm:w-[32px] aspect-square rounded-full overflow-hidden border border-[#4C526B] bg-[#29318A] flex items-center justify-center relative touch-manipulation self-center cursor-pointer" suppressHydrationWarning>
              {/* Skeleton loader - only show when loading AND there's an image to load */}
              {(isLoadingProfile || (!profileImageLoaded && userProfile?.avatar_url)) && (
                <div className="absolute inset-0 bg-gradient-to-r from-[#29318A] via-[#3D44A0] to-[#29318A] animate-pulse rounded-full" />
              )}
              {userProfile?.avatar_url && (
                <Image
                  src={userProfile.avatar_url}
                  alt="Profile"
                  className={`w-full h-full object-cover transition-opacity duration-300 ${profileImageLoaded ? 'opacity-100' : 'opacity-0'}`}
                  width={34}
                  height={34}
                  unoptimized
                  priority
                  loading="eager"
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
            </Link>

            {/* Notifications with red dot */}
            <div className="relative">
              <Button
                type="button"
                onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
                className="w-[34px] sm:w-[32px] aspect-square self-center rounded-full bg-[#29318A] flex items-center justify-center relative cursor-pointer hover:bg-[#3D44A0] transition-colors touch-manipulation"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="sm:w-[20px] sm:h-[20px] text-[#FFA412]">
                  <path d="M18 8C18 6.4087 17.3679 4.88258 16.2426 3.75736C15.1174 2.63214 13.5913 2 12 2C10.4087 2 8.88258 2.63214 7.75736 3.75736C6.63214 4.88258 6 6.4087 6 8C6 15 3 17 3 17H21C21 17 18 15 18 8Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M13.73 21C13.5542 21.3031 13.3019 21.5547 12.9982 21.7295C12.6946 21.9044 12.3504 21.9965 12 21.9965C11.6496 21.9965 11.3054 21.9044 11.0018 21.7295C10.6982 21.5547 10.4458 21.3031 10.27 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                {/* Notification red dot - only show if unread */}
                {unreadCount > 0 && (
                  <div className="absolute top-[5px] right-[8px] w-[10px] h-[10px] bg-[#EB5757] rounded-full"></div>
                )}
              </Button>

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
                    className="fixed top-[60px] sm:top-[56px] left-0 right-0 lg:right-[220px] w-full lg:w-auto max-h-[70vh] bg-[#111056] shadow-[0_10px_40px_rgba(0,0,0,0.5)] border-b border-white/10 z-[100] overflow-hidden"
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between p-[15px] border-b border-white/10">
                      <div className="flex items-center gap-[10px]">
                        <span className="text-white text-[16px] font-bold">התראות</span>
                        {unreadCount > 0 && (
                          <span className="bg-[#EB5757] text-white text-[11px] font-bold px-[8px] py-[2px] rounded-full">
                            {unreadCount}
                          </span>
                        )}
                      </div>
                      {unreadCount > 0 && (
                        <Button
                          type="button"
                          onClick={markAllAsRead}
                          className="text-[12px] text-[#FFA412] hover:text-[#FFB94A] transition-colors"
                        >
                          סמן הכל כנקרא
                        </Button>
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
                                <div className="flex items-center gap-[6px] flex-shrink-0">
                                  {!notification.is_read && (
                                    <div className="w-[8px] h-[8px] bg-[#FFA412] rounded-full"></div>
                                  )}
                                  <Button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      deleteNotification(notification.id);
                                    }}
                                    className="w-[24px] h-[24px] flex items-center justify-center rounded-full hover:bg-white/10 transition-colors text-white/30 hover:text-white/70"
                                    aria-label="מחק התראה"
                                    title="מחק"
                                  >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" />
                                      <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" />
                                    </svg>
                                  </Button>
                                </div>
                              </div>
                              {notification.message && (
                                <p className="text-[12px] text-white/50 leading-[1.4] mt-[4px] line-clamp-2">
                                  {notification.message}
                                </p>
                              )}
                              {notification.link === "/ai" && (
                                <Button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!notification.is_read) markNotificationAsRead(notification.id);
                                    router.push("/ai");
                                    setIsNotificationsOpen(false);
                                  }}
                                  className="mt-[8px] px-[14px] py-[6px] bg-[#6366f1] text-white text-[12px] font-bold rounded-[8px] hover:bg-[#7c7ff7] transition-colors inline-flex items-center gap-[6px]"
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M12 2a4 4 0 014 4v2a4 4 0 01-8 0V6a4 4 0 014-4z" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M8 14h8l2 8H6l2-8z" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                  דברו עם דדי
                                </Button>
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
            <Link href="/ai" onClick={() => { if (pathname !== "/ai") localStorage.setItem("ai_page_context", pathname); }} className="px-[8px] sm:px-[12px] min-w-[50px] sm:min-w-[60px] text-center bg-[#29318A] rounded-[7px] text-white text-[12px] sm:text-[13px] font-bold leading-[1.4] cursor-pointer hover:bg-[#3D44A0] transition-colors touch-manipulation flex items-center justify-center">
              AI
            </Link>

            {/* Help/Tour Button - disabled temporarily */}
            {/* <HelpButton /> */}

            {/* מרכזת Button - Admin Only */}
            {isAdmin && (
              <Button
                type="button"
                onClick={() => setIsCoordinatorModalOpen(true)}
                className="px-[8px] sm:px-[12px] min-w-[50px] sm:min-w-[60px] text-center bg-[#29318A] rounded-[7px] text-white text-[12px] sm:text-[13px] font-bold leading-[1.4] cursor-pointer hover:bg-[#3D44A0] transition-colors touch-manipulation flex items-center justify-center"
              >
                מרכזת
              </Button>
            )}
          </div>
        </header>

        {/* Main Content - with top padding for fixed header, right margin for sidebar on desktop */}
        <main role="main" aria-label="תוכן ראשי" className={`pt-[70px] sm:pt-[66px] ${isOcrPage ? '' : 'lg:mr-[220px]'}`}>
          <OfflineIndicator
            isOnline={offlineSync.isOnline}
            pendingCount={offlineSync.pendingCount}
            isSyncing={offlineSync.isSyncing}
            lastSyncResult={offlineSync.lastSyncResult}
            onSync={offlineSync.syncPending}
          />
          {children}
        </main>

        {/* Coordinator Modal - Admin Only */}
        {isAdmin && (
          <ConsolidatedInvoiceModal
            key={`coordinator-${isCoordinatorModalOpen}`}
            isOpen={isCoordinatorModalOpen}
            onClose={() => setIsCoordinatorModalOpen(false)}
          />
        )}
      </div>
    </DashboardContext.Provider>
    <InstallPrompt />
    <UpdatePrompt />
    <PushPrompt />
    </ToastProvider>
  );
}
