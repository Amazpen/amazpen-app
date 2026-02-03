"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useTableRealtime } from "@/hooks/useRealtimeSubscription";

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
  { id: 11, label: "התנתקות", href: "/logout", key: "logout" },
];

// Menu icon component
const MenuIcon = ({ active }: { active?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className={active ? "text-white" : "text-white/70"}>
    <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/>
    <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/>
    <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/>
    <rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2"/>
  </svg>
);

interface HeaderProps {
  title: string;
  activeKey?: string;
  selectedBusiness?: number | null;
}

interface Notification {
  id: number;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  link: string | null;
  created_at: string;
  business_id: string | null;
}

export default function Header({ title, activeKey, selectedBusiness = null }: HeaderProps) {
  const router = useRouter();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showBusinessRequiredPopup, setShowBusinessRequiredPopup] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<{
    full_name: string | null;
    avatar_url: string | null;
    email: string | null;
  } | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userBusinessIds, setUserBusinessIds] = useState<string[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [showNotificationsPanel, setShowNotificationsPanel] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Fetch user profile and their businesses
  const fetchUserProfile = async () => {
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        // User not authenticated - redirect to login
        router.push("/login");
        return;
      }

      setUserId(user.id);

      // Fetch profile
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, avatar_url, email")
        .eq("id", user.id)
        .single();

      if (profile) {
        // Reset image loaded state when profile changes
        if (profile.avatar_url !== userProfile?.avatar_url) {
          setImageLoaded(false);
        }
        setUserProfile(profile);
      }

      // Fetch user's businesses
      const { data: memberships } = await supabase
        .from("business_members")
        .select("business_id")
        .eq("user_id", user.id);

      if (memberships) {
        setUserBusinessIds(memberships.map(m => m.business_id));
      }
    } catch (error) {
      console.error("Error fetching user profile:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch unread notifications count (user's personal + their businesses)
  const fetchUnreadNotifications = async () => {
    if (!userId) return;

    try {
      const supabase = createClient();

      // Get personal notifications (user_id matches and no business_id)
      const { count: personalCount } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .is("business_id", null)
        .eq("is_read", false);

      // Get business notifications (for businesses user is member of)
      let businessCount = 0;
      if (userBusinessIds.length > 0) {
        const { count } = await supabase
          .from("notifications")
          .select("*", { count: "exact", head: true })
          .in("business_id", userBusinessIds)
          .eq("is_read", false);
        businessCount = count || 0;
      }

      setUnreadNotifications((personalCount || 0) + businessCount);
    } catch (error) {
      console.error("Error fetching notifications:", error);
    }
  };

  // Fetch full notifications list
  const fetchNotificationsList = async () => {
    if (!userId) return;

    setLoadingNotifications(true);
    try {
      const supabase = createClient();

      // Get personal notifications
      const { data: personalNotifications } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .is("business_id", null)
        .order("created_at", { ascending: false })
        .limit(20);

      // Get business notifications
      let businessNotifications: Notification[] = [];
      if (userBusinessIds.length > 0) {
        const { data } = await supabase
          .from("notifications")
          .select("*")
          .in("business_id", userBusinessIds)
          .order("created_at", { ascending: false })
          .limit(20);
        businessNotifications = (data || []) as Notification[];
      }

      // Combine and sort by date
      const allNotifications = [
        ...(personalNotifications || []),
        ...businessNotifications,
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      setNotifications(allNotifications.slice(0, 20));
    } catch (error) {
      console.error("Error fetching notifications list:", error);
    } finally {
      setLoadingNotifications(false);
    }
  };

  // Mark notification as read
  const markAsRead = async (notificationId: number) => {
    try {
      const supabase = createClient();
      await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", notificationId);

      // Update local state
      setNotifications(prev =>
        prev.map(n => n.id === notificationId ? { ...n, is_read: true } : n)
      );
      setUnreadNotifications(prev => Math.max(0, prev - 1));
    } catch (error) {
      console.error("Error marking notification as read:", error);
    }
  };

  // Mark all notifications as read
  const markAllAsRead = async () => {
    if (!userId) return;

    try {
      const supabase = createClient();

      // Mark personal notifications as read
      await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", userId)
        .is("business_id", null)
        .eq("is_read", false);

      // Mark business notifications as read
      if (userBusinessIds.length > 0) {
        await supabase
          .from("notifications")
          .update({ is_read: true })
          .in("business_id", userBusinessIds)
          .eq("is_read", false);
      }

      // Update local state
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadNotifications(0);
    } catch (error) {
      console.error("Error marking all notifications as read:", error);
    }
  };

  // Format relative time
  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return "עכשיו";
    if (diffInSeconds < 3600) return `לפני ${Math.floor(diffInSeconds / 60)} דקות`;
    if (diffInSeconds < 86400) return `לפני ${Math.floor(diffInSeconds / 3600)} שעות`;
    if (diffInSeconds < 604800) return `לפני ${Math.floor(diffInSeconds / 86400)} ימים`;
    return date.toLocaleDateString("he-IL");
  };

  // Get notification icon and color by type
  const getNotificationStyle = (type: string) => {
    switch (type) {
      case "success":
        return {
          icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3CD856" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" strokeLinecap="round"/>
              <polyline points="22 4 12 14.01 9 11.01" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ),
          bgColor: "bg-[#3CD856]/10",
          borderColor: "border-[#3CD856]/30",
        };
      case "warning":
        return {
          icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFA412" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" strokeLinecap="round" strokeLinejoin="round"/>
              <line x1="12" y1="9" x2="12" y2="13" strokeLinecap="round"/>
              <line x1="12" y1="17" x2="12.01" y2="17" strokeLinecap="round"/>
            </svg>
          ),
          bgColor: "bg-[#FFA412]/10",
          borderColor: "border-[#FFA412]/30",
        };
      case "error":
        return {
          icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F64E60" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="15" y1="9" x2="9" y2="15" strokeLinecap="round"/>
              <line x1="9" y1="9" x2="15" y2="15" strokeLinecap="round"/>
            </svg>
          ),
          bgColor: "bg-[#F64E60]/10",
          borderColor: "border-[#F64E60]/30",
        };
      default: // info
        return {
          icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A56D4" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12" strokeLinecap="round"/>
              <line x1="12" y1="8" x2="12.01" y2="8" strokeLinecap="round"/>
            </svg>
          ),
          bgColor: "bg-[#4A56D4]/10",
          borderColor: "border-[#4A56D4]/30",
        };
    }
  };

  // Handle notification panel toggle
  const handleNotificationToggle = () => {
    if (!showNotificationsPanel) {
      fetchNotificationsList();
    }
    setShowNotificationsPanel(!showNotificationsPanel);
  };

  // Initial fetch
  useEffect(() => {
    fetchUserProfile();
  }, []);

  // Fetch notifications when userId or businesses change
  useEffect(() => {
    if (userId) {
      fetchUnreadNotifications();
    }
  }, [userId, userBusinessIds]);

  // Listen for auth state changes
  useEffect(() => {
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        router.push("/login");
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [router]);

  // Listen for realtime changes to profiles table
  useTableRealtime("profiles", fetchUserProfile, {
    enabled: !!userId,
    filter: userId ? `id=eq.${userId}` : undefined,
  });

  // Listen for realtime changes to notifications table
  useTableRealtime("notifications", fetchUnreadNotifications, {
    enabled: !!userId,
    filter: userId ? `user_id=eq.${userId}` : undefined,
  });

  const handleMenuClick = (item: typeof menuItems[0], e: React.MouseEvent) => {
    if (item.requiresBusiness && !selectedBusiness) {
      e.preventDefault();
      setIsMenuOpen(false);
      setShowBusinessRequiredPopup(true);
    } else {
      setIsMenuOpen(false);
    }
  };

  return (
    <>
      {/* Sidebar Overlay */}
      {isMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-[1502]"
          onClick={() => setIsMenuOpen(false)}
        />
      )}

      {/* Sidebar Menu */}
      <div
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
          <div className="flex justify-center my-[15px]">
            <img
              src="https://ae8ccc76b2d94d531551691b1d6411c9.cdn.bubble.io/cdn-cgi/image/w=192,h=88,f=auto,dpr=2,fit=contain/f1740495696315x242439751655884480/logo%20white.png"
              alt="Logo"
              className="w-[143px] h-auto rounded-[5px]"
            />
          </div>

          <div className="flex items-center gap-[10px] p-[7px] rounded-[10px] mb-[10px]">
            <div className="w-[30px] h-[30px] rounded-[5px] flex-shrink-0 overflow-hidden bg-[#29318A] flex items-center justify-center relative">
              {/* Skeleton loader */}
              {(isLoading || (userProfile?.avatar_url && !imageLoaded)) && (
                <div className="absolute inset-0 bg-[#29318A] animate-pulse" />
              )}
              {!isLoading && userProfile?.avatar_url ? (
                <img
                  src={userProfile.avatar_url}
                  alt="User"
                  className={`w-full h-full object-cover transition-opacity duration-200 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
                  onLoad={() => setImageLoaded(true)}
                  onError={() => setImageLoaded(true)}
                />
              ) : !isLoading && !userProfile?.avatar_url ? (
                /* User icon when no avatar */
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" strokeLinecap="round" strokeLinejoin="round"/>
                  <circle cx="12" cy="7" r="4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              ) : null}
            </div>
            <span className="text-white text-[16px] font-medium text-right flex-1">
              {userProfile?.full_name || userProfile?.email || "משתמש"}
            </span>
          </div>

          <div className="flex flex-col gap-[5px]">
            {menuItems.map((item) => (
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
                  <MenuIcon active={activeKey === item.key} />
                </div>
                <span className="text-white text-[14px] font-medium text-right flex-1">{item.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>

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

      {/* Notifications Panel Overlay - Facebook style */}
      {showNotificationsPanel && (
        <div
          className="fixed inset-0 z-[9998]"
          onClick={() => setShowNotificationsPanel(false)}
        />
      )}

      {/* Notifications Dropdown Panel - Facebook style */}
      <div
        className={`fixed top-[52px] sm:top-[56px] left-4 right-4 sm:left-auto sm:right-4 sm:w-[360px] max-h-[80vh] bg-[#1a1f4a] z-[9999] rounded-[12px] shadow-[0_4px_30px_rgba(0,0,0,0.5)] border border-white/10 overflow-hidden transform transition-all duration-200 origin-top ${
          showNotificationsPanel
            ? "opacity-100 scale-100 translate-y-0"
            : "opacity-0 scale-95 -translate-y-2 pointer-events-none"
        }`}
      >
        {/* Panel Header - Facebook style */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <h2 className="text-white text-[20px] font-bold">התראות</h2>
          {unreadNotifications > 0 && (
            <button
              type="button"
              onClick={markAllAsRead}
              className="text-[#4A56D4] text-[13px] font-medium hover:text-[#6B75E8] transition-colors"
            >
              סמן הכל כנקרא
            </button>
          )}
        </div>

        {/* Notifications List */}
        <div className="flex flex-col max-h-[calc(80vh-60px)] overflow-y-auto">
          {loadingNotifications ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin w-8 h-8 border-4 border-[#29318A]/30 border-t-[#29318A] rounded-full"></div>
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <div className="w-16 h-16 rounded-full bg-[#29318A]/30 flex items-center justify-center mb-4">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-white/50">
                  <path d="M18 8C18 6.4087 17.3679 4.88258 16.2426 3.75736C15.1174 2.63214 13.5913 2 12 2C10.4087 2 8.88258 2.63214 7.75736 3.75736C6.63214 4.88258 6 6.4087 6 8C6 15 3 17 3 17H21C21 17 18 15 18 8Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M13.73 21C13.5542 21.3031 13.3019 21.5547 12.9982 21.7295C12.6946 21.9044 12.3504 21.9965 12 21.9965C11.6496 21.9965 11.3054 21.9044 11.0018 21.7295C10.6982 21.5547 10.4458 21.3031 10.27 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
              <p className="text-white/70 text-[14px] text-center">אין התראות חדשות</p>
            </div>
          ) : (
            <div className="flex flex-col py-1">
              {notifications.map((notification) => {
                const style = getNotificationStyle(notification.type);
                return (
                  <div
                    key={notification.id}
                    onClick={() => {
                      if (!notification.is_read) {
                        markAsRead(notification.id);
                      }
                      if (notification.link) {
                        router.push(notification.link);
                        setShowNotificationsPanel(false);
                      }
                    }}
                    className={`flex gap-3 px-4 py-3 cursor-pointer transition-all duration-150 hover:bg-white/5 rounded-lg mx-2 my-0.5 ${
                      !notification.is_read ? "bg-[#29318A]/30" : ""
                    }`}
                  >
                    {/* Icon - Facebook style circular */}
                    <div className={`w-12 h-12 rounded-full ${style.bgColor} flex items-center justify-center flex-shrink-0 relative`}>
                      {style.icon}
                      {/* Small type indicator badge */}
                      <div className={`absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full ${
                        notification.type === 'success' ? 'bg-[#3CD856]' :
                        notification.type === 'warning' ? 'bg-[#FFA412]' :
                        notification.type === 'error' ? 'bg-[#F64E60]' :
                        'bg-[#4A56D4]'
                      } flex items-center justify-center`}>
                        {notification.type === 'success' && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                            <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                        {notification.type === 'warning' && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                            <line x1="12" y1="8" x2="12" y2="12" strokeLinecap="round"/>
                            <line x1="12" y1="16" x2="12.01" y2="16" strokeLinecap="round"/>
                          </svg>
                        )}
                        {notification.type === 'error' && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                            <line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round"/>
                            <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round"/>
                          </svg>
                        )}
                        {notification.type === 'info' && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                            <line x1="12" y1="16" x2="12" y2="12" strokeLinecap="round"/>
                            <line x1="12" y1="8" x2="12.01" y2="8" strokeLinecap="round"/>
                          </svg>
                        )}
                      </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-[14px] leading-[1.4] ${!notification.is_read ? "text-white" : "text-white/80"}`}>
                        <span className="font-semibold">{notification.title}</span>
                        {notification.message && (
                          <span className="text-white/70"> - {notification.message}</span>
                        )}
                      </p>
                      <span className={`text-[12px] mt-1 block ${!notification.is_read ? "text-[#4A56D4] font-medium" : "text-white/50"}`}>
                        {formatRelativeTime(notification.created_at)}
                      </span>
                    </div>

                    {/* Unread indicator dot */}
                    {!notification.is_read && (
                      <div className="w-3 h-3 rounded-full bg-[#4A56D4] flex-shrink-0 self-center"></div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Sticky Header */}
      <header className="sticky top-0 z-50 bg-[#0f1231] flex justify-between items-center px-3 sm:px-4 py-2 sm:py-3">
        {/* Right side - Menu and Title */}
        <div className="flex items-center gap-[5px]">
          <button
            type="button"
            aria-label="תפריט"
            title="תפריט"
            onClick={() => setIsMenuOpen(true)}
            className="w-[36px] h-[36px] sm:w-[40px] sm:h-[40px] flex items-center justify-center text-[#4C526B] cursor-pointer"
          >
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="sm:w-8 sm:h-8">
              <path d="M5 8H27M5 16H27M5 24H27" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
          <span className="text-white text-[16px] sm:text-[19px] font-bold leading-[1.4]">{title}</span>
        </div>

        {/* Left side - Profile, Notifications, Buttons */}
        <div className="flex flex-row-reverse items-center gap-1 sm:gap-[5px]">
          {/* Profile Image */}
          <div className="w-[36px] h-[36px] sm:w-[40px] sm:h-[40px] rounded-full overflow-hidden border border-[#4C526B] bg-[#29318A] flex items-center justify-center relative">
            {/* Skeleton loader - shown while loading or while image is loading */}
            {(isLoading || (userProfile?.avatar_url && !imageLoaded)) && (
              <div className="absolute inset-0 bg-[#29318A] animate-pulse" />
            )}
            {!isLoading && userProfile?.avatar_url ? (
              <img
                src={userProfile.avatar_url}
                alt="Profile"
                className={`w-full h-full object-cover transition-opacity duration-200 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
                onLoad={() => setImageLoaded(true)}
                onError={() => setImageLoaded(true)}
              />
            ) : !isLoading && !userProfile?.avatar_url ? (
              /* User icon when no avatar */
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="sm:w-[22px] sm:h-[22px]">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="12" cy="7" r="4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : null}
          </div>

          {/* Notifications with red dot */}
          <button
            type="button"
            title="התראות"
            onClick={handleNotificationToggle}
            className="w-[36px] h-[36px] sm:w-[40px] sm:h-[40px] rounded-full bg-[#29318A] flex items-center justify-center relative cursor-pointer hover:bg-[#3a42a0] transition-colors"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="sm:w-[25px] sm:h-[25px] text-[#FFA412]">
              <path d="M18 8C18 6.4087 17.3679 4.88258 16.2426 3.75736C15.1174 2.63214 13.5913 2 12 2C10.4087 2 8.88258 2.63214 7.75736 3.75736C6.63214 4.88258 6 6.4087 6 8C6 15 3 17 3 17H21C21 17 18 15 18 8Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              <path d="M13.73 21C13.5542 21.3031 13.3019 21.5547 12.9982 21.7295C12.6946 21.9044 12.3504 21.9965 12 21.9965C11.6496 21.9965 11.3054 21.9044 11.0018 21.7295C10.6982 21.5547 10.4458 21.3031 10.27 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            {/* Notification red dot - only show when there are unread notifications */}
            {unreadNotifications > 0 && (
              <div className="absolute top-[5px] right-[8px] w-[10px] h-[10px] bg-[#EB5757] rounded-full"></div>
            )}
          </button>

          {/* מרכזת Button */}
          <button type="button" className="px-2 sm:px-[14px] py-[3px] border border-white rounded-[7px] text-white text-[12px] sm:text-[14px] leading-[1.4] cursor-pointer hover:bg-white/10 transition-colors">
            מרכזת
          </button>

          {/* עוזר AI Button */}
          <button type="button" className="px-2 sm:px-[14px] py-[3px] border border-white rounded-[7px] text-white text-[12px] sm:text-[14px] leading-[1.4] cursor-pointer hover:bg-white/10 transition-colors">
            עוזר AI
          </button>
        </div>
      </header>
    </>
  );
}
