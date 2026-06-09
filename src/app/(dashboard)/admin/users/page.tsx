"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { uploadFile } from "@/lib/uploadFile";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";
import { generateUUID } from "@/lib/utils";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Role labels in Hebrew
const roleLabels: Record<string, string> = {
  owner: "בעלים",
  manager: "מנהל",
  employee: "עובד",
};

// Role colors
const roleColors: Record<string, string> = {
  owner: "bg-[#4A56D4] text-white",
  manager: "bg-[#3CD856] text-white",
  employee: "bg-[#4A56D4]/50 text-white",
};

// Sort weight for role-based sorting (higher = first)
const roleSortWeight: Record<string, number> = {
  owner: 3,
  manager: 2,
  employee: 1,
};

type SortOption = "recent" | "name" | "role";

// Short he-IL date (e.g. "31.5.26"). Returns "" for null/invalid.
function formatJoinDate(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("he-IL", { day: "numeric", month: "numeric", year: "2-digit" });
}

interface MembershipChip {
  businessName: string;
  role: string;
}

interface Business {
  id: string;
  name: string;
}

interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  is_admin: boolean;
  created_at: string;
}

interface UserMember {
  id: string;
  user_id: string;
  business_id: string;
  role: string;
  invited_at: string | null;
  joined_at: string | null;
  created_at: string | null;
  profiles: {
    id: string;
    email: string;
    full_name: string | null;
    phone: string | null;
    avatar_url: string | null;
  };
  businesses: {
    id: string;
    name: string;
  };
}

export default function AdminUsersPage() {
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = usePersistedState<string>("admin-users:businessId", "all");
  const [allUsers, setAllUsers] = useState<Profile[]>([]);
  const [businessUsers, setBusinessUsers] = useState<UserMember[]>([]);
  const [membershipsByUser, setMembershipsByUser] = useState<Record<string, MembershipChip[]>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = usePersistedState<SortOption>("admin-users:sortBy", "recent");
  const [isListLoading, setIsListLoading] = useState(true);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Edit user state
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [editUserName, setEditUserName] = useState("");
  const [editUserPhone, setEditUserPhone] = useState("");
  const [editUserAvatarUrl, setEditUserAvatarUrl] = useState("");
  const [editUserIsAdmin, setEditUserIsAdmin] = useState(false);
  const [editUserNewPassword, setEditUserNewPassword] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  // Form state
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserPhone, setNewUserPhone] = useState("");
  const [newUserAvatarUrl, setNewUserAvatarUrl] = useState("");
  const [newUserIsAdmin, setNewUserIsAdmin] = useState(false);
  const [newUserBusinessId, setNewUserBusinessId] = useState<string>("");
  const [newUserRole, setNewUserRole] = useState<"owner" | "manager" | "employee">("employee");
  const [createError, setCreateError] = useState<string | null>(null);

  // File upload refs
  const newAvatarInputRef = useRef<HTMLInputElement>(null);
  const editAvatarInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingNewAvatar, setIsUploadingNewAvatar] = useState(false);
  const [isUploadingEditAvatar, setIsUploadingEditAvatar] = useState(false);

  // Fetch initial data
  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) return;

      // Check if user is admin
      const { data: profile } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", user.id)
        .single();

      const userIsAdmin = profile?.is_admin === true;
      setIsAdmin(userIsAdmin);

      if (userIsAdmin) {
        // Fetch all businesses
        const { data: allBusinesses } = await supabase
          .from("businesses")
          .select("id, name")
          .order("name");

        if (allBusinesses) {
          setBusinesses(allBusinesses);
        }
      }

      setIsLoading(false);
    };

    fetchData();
  }, []);

  // Upload avatar to Supabase Storage
  const uploadAvatar = async (file: File, userId?: string): Promise<string | null> => {
    const fileExt = file.name.split(".").pop();
    const fileName = `avatars/${userId || generateUUID()}-${Date.now()}.${fileExt}`;

    const result = await uploadFile(file, fileName, "assets");

    if (!result.success) {
      console.error("Error uploading avatar:", result.error);
      return null;
    }

    return result.publicUrl || null;
  };

  const handleNewAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      setCreateError("יש להעלות קובץ תמונה בלבד");
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      setCreateError("גודל התמונה המקסימלי הוא 2MB");
      return;
    }

    setIsUploadingNewAvatar(true);
    const url = await uploadAvatar(file);
    setIsUploadingNewAvatar(false);

    if (url) {
      setNewUserAvatarUrl(url);
      setCreateError(null);
    } else {
      setCreateError("שגיאה בהעלאת התמונה");
    }
  };

  const handleEditAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      setEditError("יש להעלות קובץ תמונה בלבד");
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      setEditError("גודל התמונה המקסימלי הוא 2MB");
      return;
    }

    setIsUploadingEditAvatar(true);
    const url = await uploadAvatar(file, editingUser?.id);
    setIsUploadingEditAvatar(false);

    if (url) {
      setEditUserAvatarUrl(url);
      setEditError(null);
    } else {
      setEditError("שגיאה בהעלאת התמונה");
    }
  };

  // Fetch users based on selection
  const fetchUsers = useCallback(async () => {
    const supabase = createClient();

    if (selectedBusinessId === "all") {
      // Fetch all users from profiles + their business memberships (for chips)
      const [{ data }, { data: memberRows }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, email, full_name, phone, avatar_url, is_admin, created_at")
          .order("created_at", { ascending: false }),
        supabase
          .from("business_members")
          .select("user_id, role, businesses(id, name, deleted_at)")
          .is("deleted_at", null),
      ]);

      if (data) {
        setAllUsers(data);
        setBusinessUsers([]);
      }

      // Build user_id -> [{ businessName, role }], skipping soft-deleted businesses
      const map: Record<string, MembershipChip[]> = {};
      for (const row of (memberRows ?? []) as unknown as Array<{
        user_id: string;
        role: string;
        businesses: { id: string; name: string; deleted_at: string | null } | null;
      }>) {
        const biz = row.businesses;
        if (!biz || biz.deleted_at) continue;
        (map[row.user_id] ??= []).push({ businessName: biz.name, role: row.role });
      }
      setMembershipsByUser(map);
    } else {
      // Fetch users for specific business
      const { data } = await supabase
        .from("business_members")
        .select(`
          id,
          user_id,
          business_id,
          role,
          invited_at,
          joined_at,
          created_at,
          profiles(id, email, full_name, phone, avatar_url),
          businesses(id, name)
        `)
        .eq("business_id", selectedBusinessId)
        .order("role", { ascending: true });

      if (data) {
        setBusinessUsers(data as unknown as UserMember[]);
        setAllUsers([]);
        setMembershipsByUser({});
      }
    }

    setIsListLoading(false);
  }, [selectedBusinessId]);

  // Show skeleton while the active filter's data is (re)loading
  useEffect(() => {
    setIsListLoading(true);
  }, [selectedBusinessId]);

  // "role" sort only applies to a specific business; reset it in the "all" view
  useEffect(() => {
    if (selectedBusinessId === "all" && sortBy === "role") {
      setSortBy("recent");
    }
  }, [selectedBusinessId, sortBy, setSortBy]);

  useEffect(() => {
    if (!isLoading && isAdmin) {
      fetchUsers();
    }
  }, [fetchUsers, isLoading, isAdmin]);

  // Realtime — profiles and business_members can be edited by another admin
  // or created via signup; refresh so the user list stays live.
  useMultiTableRealtime(
    ["profiles", "business_members"],
    fetchUsers,
    !isLoading && isAdmin,
  );

  // Filtered + sorted "all users" list (client-side, on already-fetched data)
  const filteredAllUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = allUsers;
    if (q) {
      list = list.filter(
        (u) =>
          (u.full_name || "").toLowerCase().includes(q) ||
          (u.email || "").toLowerCase().includes(q) ||
          (u.phone || "").toLowerCase().includes(q),
      );
    }
    const sorted = [...list];
    if (sortBy === "name") {
      sorted.sort((a, b) =>
        (a.full_name || a.email || "").localeCompare(b.full_name || b.email || "", "he"),
      );
    } else {
      // "recent" (and "role" has no meaning here → fall back to recent)
      sorted.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    }
    return sorted;
  }, [allUsers, searchQuery, sortBy]);

  // Filtered + sorted business-members list
  const filteredBusinessUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = businessUsers;
    if (q) {
      list = list.filter(
        (m) =>
          (m.profiles.full_name || "").toLowerCase().includes(q) ||
          (m.profiles.email || "").toLowerCase().includes(q),
      );
    }
    const sorted = [...list];
    if (sortBy === "name") {
      sorted.sort((a, b) =>
        (a.profiles.full_name || a.profiles.email || "").localeCompare(
          b.profiles.full_name || b.profiles.email || "",
          "he",
        ),
      );
    } else if (sortBy === "role") {
      sorted.sort((a, b) => (roleSortWeight[b.role] || 0) - (roleSortWeight[a.role] || 0));
    } else {
      // "recent": pending (no joined_at) first, then most-recent joined
      sorted.sort((a, b) => {
        const aJoined = a.joined_at || a.created_at || "";
        const bJoined = b.joined_at || b.created_at || "";
        if (!a.joined_at && b.joined_at) return -1;
        if (a.joined_at && !b.joined_at) return 1;
        return bJoined.localeCompare(aJoined);
      });
    }
    return sorted;
  }, [businessUsers, searchQuery, sortBy]);

  const visibleCount =
    selectedBusinessId === "all" ? filteredAllUsers.length : filteredBusinessUsers.length;

  const handleCreateUser = async () => {
    if (!newUserEmail.trim() || !newUserPassword.trim()) return;

    if (newUserPassword.length < 6) {
      setCreateError("הסיסמה חייבת להכיל לפחות 6 תווים");
      return;
    }

    setIsSubmitting(true);
    setCreateError(null);
    const supabase = createClient();

    try {
      // Check if user already exists
      const { data: existingProfile } = await supabase
        .from("profiles")
        .select("id")
        .eq("email", newUserEmail.toLowerCase())
        .maybeSingle();

      if (existingProfile) {
        setCreateError("משתמש עם אימייל זה כבר קיים במערכת");
        setIsSubmitting(false);
        return;
      }

      // Create user via server API route (uses service role key, no email sent)
      const response = await fetch("/api/admin/create-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newUserEmail.toLowerCase(),
          password: newUserPassword,
          fullName: newUserName || null,
          phone: newUserPhone || null,
          avatarUrl: newUserAvatarUrl || null,
          businessId: newUserBusinessId && newUserBusinessId !== "" ? newUserBusinessId : null,
          role: newUserRole,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "שגיאה ביצירת המשתמש");
      }

      // Update is_admin flag if needed (API route doesn't handle this)
      if (newUserIsAdmin && result.userId) {
        const { error: adminError } = await supabase
          .from("profiles")
          .update({ is_admin: true })
          .eq("id", result.userId);

        if (adminError) {
          console.error("Error setting admin flag:", adminError);
        }
      }

      // Success - close dialog and refresh
      setIsCreateDialogOpen(false);
      setNewUserEmail("");
      setNewUserPassword("");
      setNewUserName("");
      setNewUserPhone("");
      setNewUserAvatarUrl("");
      setNewUserIsAdmin(false);
      setNewUserBusinessId("");
      setNewUserRole("employee");
      fetchUsers();
    } catch (error) {
      console.error("Error creating user:", error);
      setCreateError(error instanceof Error ? error.message : "שגיאה ביצירת המשתמש");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteUser = (userId: string, userEmail: string) => {
    confirm(`האם אתה בטוח שברצונך למחוק את ${userEmail}?`, async () => {
      try {
        const res = await fetch("/api/admin/delete-user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        });

        const data = await res.json();

        if (!res.ok) {
          showToast(data.error || "שגיאה במחיקת המשתמש", "error");
        } else {
          showToast("המשתמש נמחק בהצלחה", "success");
          fetchUsers();
        }
      } catch {
        showToast("שגיאה במחיקת המשתמש", "error");
      }
    });
  };

  const handleToggleAdmin = async (userId: string, currentIsAdmin: boolean) => {
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ is_admin: !currentIsAdmin })
      .eq("id", userId);

    if (error) {
      showToast("שגיאה בעדכון הרשאות", "error");
    } else {
      fetchUsers();
    }
  };

  const handleRemoveFromBusiness = (memberId: string, userEmail: string) => {
    confirm(`האם אתה בטוח שברצונך להסיר את ${userEmail} מהעסק?`, async () => {
      const supabase = createClient();
      const { error } = await supabase
        .from("business_members")
        .delete()
        .eq("id", memberId);

      if (error) {
        showToast("שגיאה בהסרת המשתמש", "error");
      } else {
        fetchUsers();
      }
    });
  };

  const handleUpdateRole = async (memberId: string, newRole: string) => {
    const supabase = createClient();
    const { error } = await supabase
      .from("business_members")
      .update({ role: newRole })
      .eq("id", memberId);

    if (error) {
      showToast("שגיאה בעדכון התפקיד", "error");
    } else {
      fetchUsers();
    }
  };

  const openEditDialog = (user: Profile) => {
    setEditingUser(user);
    setEditUserName(user.full_name || "");
    setEditUserPhone(user.phone || "");
    setEditUserAvatarUrl(user.avatar_url || "");
    setEditUserIsAdmin(user.is_admin);
    setEditUserNewPassword("");
    setEditError(null);
    setIsEditDialogOpen(true);
  };

  const handleUpdateUser = async () => {
    if (!editingUser) return;

    // Validate password if provided
    if (editUserNewPassword && editUserNewPassword.length < 6) {
      setEditError("הסיסמה חייבת להכיל לפחות 6 תווים");
      return;
    }

    setIsSubmitting(true);
    setEditError(null);
    const supabase = createClient();

    try {
      // Update profile
      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          full_name: editUserName || null,
          phone: editUserPhone || null,
          avatar_url: editUserAvatarUrl || null,
          is_admin: editUserIsAdmin,
          updated_at: new Date().toISOString(),
        })
        .eq("id", editingUser.id);

      if (profileError) {
        throw new Error(profileError.message);
      }

      // Update password if provided via server API
      if (editUserNewPassword) {
        const response = await fetch("/api/admin/update-user-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: editingUser.id,
            newPassword: editUserNewPassword,
          }),
        });

        const result = await response.json();

        if (!response.ok) {
          setEditError(result.error || "שגיאה בשינוי הסיסמה");
          setIsSubmitting(false);
          fetchUsers();
          return;
        }
      }

      // Success - close dialog and refresh
      setIsEditDialogOpen(false);
      setEditingUser(null);
      fetchUsers();
    } catch (error) {
      console.error("Error updating user:", error);
      setEditError(error instanceof Error ? error.message : "שגיאה בעדכון המשתמש");
    } finally {
      setIsSubmitting(false);
    }
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
        <p className="text-[14px] text-white/60 text-center">רק מנהלי מערכת יכולים לנהל משתמשים</p>
      </div>
    );
  }

  return (
    <div dir="rtl" className="flex flex-col min-h-[calc(100vh-52px)] text-white px-[10px] py-[10px] pb-[100px]">
      <ConfirmDialog />
      {/* Header */}
      <div className="flex flex-col items-center gap-[10px] mb-[20px]">
        <h1 className="text-[24px] font-bold text-white">ניהול משתמשים</h1>
        <p className="text-[14px] text-white/50 text-center">ניהול משתמשים, הרשאות ושיוך לעסקים</p>
      </div>

      {/* Filter Selector */}
      <div className="mb-[20px]">
        <label className="text-[14px] font-medium text-white/70 block mb-[8px]">סינון לפי</label>
        <Select value={selectedBusinessId} onValueChange={(val) => setSelectedBusinessId(val)}>
          <SelectTrigger className="w-full bg-[#0F1535] border border-[#727BA0] rounded-[10px] h-[50px] px-[12px] text-[14px] text-white text-right">
            <SelectValue placeholder="בחר סינון" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל המשתמשים במערכת</SelectItem>
            {businesses.map((business) => (
              <SelectItem key={business.id} value={business.id}>
                {business.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Search + Sort Bar */}
      <div className="flex gap-[10px] mb-[15px] flex-col sm:flex-row">
        {/* Search (first in DOM = right side in RTL) */}
        <div className="relative flex-1">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            className="absolute right-[14px] top-1/2 -translate-y-1/2 text-white/40 pointer-events-none"
          >
            <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2" />
            <path d="M21 21L16.65 16.65" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="חיפוש לפי שם, אימייל או טלפון"
            className="w-full bg-[#0F1535] border border-[#727BA0] rounded-[10px] h-[50px] ps-[44px] pe-[40px] text-[14px] text-white text-right placeholder:text-white/30"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              title="נקה חיפוש"
              aria-label="נקה חיפוש"
              className="absolute left-[12px] top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>

        {/* Sort (second in DOM = left side in RTL) */}
        <Select value={sortBy} onValueChange={(val) => setSortBy(val as SortOption)}>
          <SelectTrigger className="sm:w-[170px] bg-[#0F1535] border border-[#727BA0] rounded-[10px] h-[50px] px-[12px] text-[14px] text-white text-right">
            <SelectValue placeholder="מיון" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">הצטרפו לאחרונה</SelectItem>
            <SelectItem value="name">שם (א-ב)</SelectItem>
            {selectedBusinessId !== "all" && <SelectItem value="role">תפקיד</SelectItem>}
          </SelectContent>
        </Select>
      </div>

      {/* Add User Button */}
      <Button
        variant="default"
        type="button"
        onClick={() => setIsCreateDialogOpen(true)}
        className="flex items-center justify-center gap-[8px] bg-[#3CD856] text-white text-[16px] font-semibold py-[14px] rounded-[10px] mb-[20px] transition-colors hover:bg-[#2fb847]"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
        הוסף משתמש חדש
      </Button>

      {/* Count */}
      <div className="flex items-center mb-[10px] px-[4px]">
        <span className="text-[13px] text-white/50">
          {visibleCount} משתמשים
          {searchQuery.trim() && " (תוצאות חיפוש)"}
        </span>
      </div>

      {/* Users List */}
      <div className="flex flex-col gap-[10px]">
        {isListLoading ? (
          // Loading skeleton
          Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="bg-[#0F1535] rounded-[15px] p-[15px] flex items-center gap-[12px] animate-pulse"
            >
              <div className="w-[50px] h-[50px] rounded-full bg-white/10 flex-shrink-0" />
              <div className="flex-1 min-w-0 flex flex-col gap-[8px]">
                <div className="h-[14px] w-[40%] bg-white/10 rounded-[4px]" />
                <div className="h-[12px] w-[60%] bg-white/10 rounded-[4px]" />
              </div>
            </div>
          ))
        ) : selectedBusinessId === "all" ? (
          // Show all profiles
          filteredAllUsers.length === 0 ? (
            <div className="text-center py-[40px]">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="mx-auto mb-[15px] text-[#979797]">
                <path d="M17 21V19C17 17.9391 16.5786 16.9217 15.8284 16.1716C15.0783 15.4214 14.0609 15 13 15H5C3.93913 15 2.92172 15.4214 2.17157 16.1716C1.42143 16.9217 1 17.9391 1 19V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2"/>
              </svg>
              <p className="text-[14px] text-[#979797]">
                {searchQuery.trim() ? "לא נמצאו משתמשים התואמים לחיפוש" : "אין משתמשים במערכת"}
              </p>
            </div>
          ) : (
            filteredAllUsers.map((user) => (
              <div
                key={user.id}
                className="bg-[#0F1535] rounded-[15px] p-[15px] flex items-center gap-[12px]"
              >
                {/* Avatar */}
                <div className="w-[50px] h-[50px] rounded-full bg-[#4A56D4] flex items-center justify-center overflow-hidden flex-shrink-0">
                  {user.avatar_url ? (
                    <Image
                      src={user.avatar_url}
                      alt={user.full_name || "User"}
                      className="w-full h-full object-cover"
                      width={50}
                      height={50}
                      unoptimized
                      loading="eager"
                    />
                  ) : (
                    <span className="text-white text-[20px] font-bold">
                      {(user.full_name || user.email || "?")[0].toUpperCase()}
                    </span>
                  )}
                </div>

                {/* User Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-[8px] mb-[4px]">
                    <h3 className="text-[16px] font-bold text-white truncate">
                      {user.full_name || user.email?.split("@")[0] || "משתמש"}
                    </h3>
                    {user.is_admin && (
                      <span className="text-[10px] bg-[#4A56D4] text-white px-[6px] py-[2px] rounded-full">
                        אדמין
                      </span>
                    )}
                  </div>
                  <p className="text-[13px] text-white/60 truncate">{user.email}</p>
                  {user.phone && (
                    <div className="flex items-center gap-[4px] mt-[2px] text-[12px] text-white/50">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="flex-shrink-0">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.94.36 1.86.7 2.73a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.87.34 1.79.57 2.73.7A2 2 0 0 1 22 16.92z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      <span dir="ltr">{user.phone}</span>
                    </div>
                  )}
                  {(membershipsByUser[user.id]?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap gap-[4px] mt-[6px]">
                      {membershipsByUser[user.id].map((m, i) => (
                        <span
                          key={i}
                          className="text-[10px] bg-[#4A56D4]/30 text-white/80 px-[6px] py-[2px] rounded-full"
                        >
                          {m.businessName} · {roleLabels[m.role] || m.role}
                        </span>
                      ))}
                    </div>
                  )}
                  {user.created_at && (
                    <p className="text-[11px] text-white/40 mt-[4px]">נוצר: {formatJoinDate(user.created_at)}</p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex flex-col items-end gap-[8px]">
                  <div className="flex items-center gap-[6px]">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      type="button"
                      onClick={() => openEditDialog(user)}
                      className="text-[#3CD856] hover:bg-[#3CD856]/20 p-[4px] rounded-full transition-colors"
                      title="ערוך משתמש"
                      aria-label="ערוך משתמש"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <path d="M11 4H4C3.46957 4 2.96086 4.21071 2.58579 4.58579C2.21071 4.96086 2 5.46957 2 6V20C2 20.5304 2.21071 21.0391 2.58579 21.4142C2.96086 21.7893 3.46957 22 4 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M18.5 2.50001C18.8978 2.10219 19.4374 1.87869 20 1.87869C20.5626 1.87869 21.1022 2.10219 21.5 2.50001C21.8978 2.89784 22.1213 3.4374 22.1213 4.00001C22.1213 4.56262 21.8978 5.10219 21.5 5.50001L12 15L8 16L9 12L18.5 2.50001Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      type="button"
                      onClick={() => handleDeleteUser(user.id, user.email)}
                      className="text-[#F64E60] hover:bg-[#F64E60]/20 p-[4px] rounded-full transition-colors"
                      title="מחק משתמש"
                      aria-label="מחק משתמש"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        <path d="M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    </Button>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => handleToggleAdmin(user.id, user.is_admin)}
                    className={`text-[12px] font-bold px-[10px] py-[4px] rounded-full transition-colors ${
                      user.is_admin
                        ? "bg-[#4A56D4] text-white hover:bg-[#3D44A0]"
                        : "bg-[#4A56D4]/50 text-white hover:bg-[#4A56D4]/70"
                    }`}
                  >
                    {user.is_admin ? "הסר אדמין" : "הפוך לאדמין"}
                  </Button>
                </div>
              </div>
            ))
          )
        ) : (
          // Show business members
          filteredBusinessUsers.length === 0 ? (
            <div className="text-center py-[40px]">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="mx-auto mb-[15px] text-[#979797]">
                <path d="M17 21V19C17 17.9391 16.5786 16.9217 15.8284 16.1716C15.0783 15.4214 14.0609 15 13 15H5C3.93913 15 2.92172 15.4214 2.17157 16.1716C1.42143 16.9217 1 17.9391 1 19V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2"/>
              </svg>
              <p className="text-[14px] text-[#979797]">
                {searchQuery.trim() ? "לא נמצאו משתמשים התואמים לחיפוש" : "אין משתמשים בעסק זה"}
              </p>
            </div>
          ) : (
            filteredBusinessUsers.map((member) => (
              <div
                key={member.id}
                className="bg-[#0F1535] rounded-[15px] p-[15px] flex items-center gap-[12px]"
              >
                {/* Avatar */}
                <div className="w-[50px] h-[50px] rounded-full bg-[#4A56D4] flex items-center justify-center overflow-hidden flex-shrink-0">
                  {member.profiles.avatar_url ? (
                    <Image
                      src={member.profiles.avatar_url}
                      alt={member.profiles.full_name || "User"}
                      className="w-full h-full object-cover"
                      width={50}
                      height={50}
                      unoptimized
                      loading="eager"
                    />
                  ) : (
                    <span className="text-white text-[20px] font-bold">
                      {(member.profiles.full_name || member.profiles.email || "?")[0].toUpperCase()}
                    </span>
                  )}
                </div>

                {/* User Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-[8px] mb-[4px]">
                    <h3 className="text-[16px] font-bold text-white truncate">
                      {member.profiles.full_name || member.profiles.email?.split("@")[0] || "משתמש"}
                    </h3>
                    {!member.joined_at && (
                      <span className="text-[10px] bg-[#4A56D4] text-white px-[6px] py-[2px] rounded-full">
                        ממתין
                      </span>
                    )}
                  </div>
                  <p className="text-[13px] text-white/60 truncate">{member.profiles.email}</p>
                  {member.profiles.phone && (
                    <div className="flex items-center gap-[4px] mt-[2px] text-[12px] text-white/50">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="flex-shrink-0">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.94.36 1.86.7 2.73a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.87.34 1.79.57 2.73.7A2 2 0 0 1 22 16.92z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      <span dir="ltr">{member.profiles.phone}</span>
                    </div>
                  )}
                  {member.joined_at && (
                    <p className="text-[11px] text-white/40 mt-[4px]">הצטרף/ה: {formatJoinDate(member.joined_at)}</p>
                  )}
                </div>

                {/* Role Badge & Actions */}
                <div className="flex flex-col items-end gap-[8px]">
                  <Select value={member.role} onValueChange={(val) => handleUpdateRole(member.id, val)}>
                    <SelectTrigger className={`text-[12px] font-bold px-[10px] py-[4px] h-auto rounded-full border-none bg-transparent ${roleColors[member.role] || roleColors.employee}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="owner">בעלים</SelectItem>
                      <SelectItem value="manager">מנהל</SelectItem>
                      <SelectItem value="employee">עובד</SelectItem>
                    </SelectContent>
                  </Select>

                  <Button
                    variant="ghost"
                    size="icon-sm"
                    type="button"
                    onClick={() => handleRemoveFromBusiness(member.id, member.profiles.email)}
                    className="text-[#F64E60] hover:bg-[#F64E60]/20 p-[4px] rounded-full transition-colors"
                    title="הסר מעסק"
                    aria-label="הסר משתמש מעסק"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      <path d="M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  </Button>
                </div>
              </div>
            ))
          )
        )}
      </div>

      {/* Create User Dialog */}
      {isCreateDialogOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-[2001]"
            onClick={() => setIsCreateDialogOpen(false)}
          />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-40px)] max-w-[400px] bg-[#0F1535] rounded-[20px] p-[25px] z-[2002] shadow-[0_10px_40px_rgba(0,0,0,0.5)] border border-white/10 max-h-[90vh] overflow-y-auto">
            {/* Dialog Header */}
            <div className="flex items-center justify-between mb-[20px] flex-row-reverse">
              <Button
                variant="ghost"
                size="icon"
                type="button"
                onClick={() => setIsCreateDialogOpen(false)}
                title="סגור"
                aria-label="סגור חלון"
                className="w-[32px] h-[32px] flex items-center justify-center text-white/70 hover:text-white transition-colors"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </Button>
              <h2 className="text-[20px] font-bold text-white">הוספת משתמש חדש</h2>
            </div>

            {/* Form */}
            <div className="flex flex-col gap-[15px]">
              {/* Email */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[14px] font-medium text-white text-right">
                  אימייל <span className="text-[#F64E60]">*</span>
                </label>
                <div className="border border-[#727BA0] rounded-[10px] h-[50px]">
                  <Input
                    type="email"
                    value={newUserEmail}
                    onChange={(e) => setNewUserEmail(e.target.value)}
                    placeholder="user@example.com"
                    className="w-full h-full bg-transparent text-white text-[14px] text-right rounded-[10px] border-none outline-none px-[15px] placeholder:text-white/30"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[14px] font-medium text-white text-right">
                  סיסמה <span className="text-[#F64E60]">*</span>
                </label>
                <div className="border border-[#727BA0] rounded-[10px] h-[50px]">
                  <Input
                    type="password"
                    value={newUserPassword}
                    onChange={(e) => setNewUserPassword(e.target.value)}
                    placeholder="לפחות 6 תווים"
                    className="w-full h-full bg-transparent text-white text-[14px] text-right rounded-[10px] border-none outline-none px-[15px] placeholder:text-white/30"
                  />
                </div>
              </div>

              {/* Name */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[14px] font-medium text-white text-right">שם מלא</label>
                <div className="border border-[#727BA0] rounded-[10px] h-[50px]">
                  <Input
                    type="text"
                    value={newUserName}
                    onChange={(e) => setNewUserName(e.target.value)}
                    placeholder="שם המשתמש"
                    className="w-full h-full bg-transparent text-white text-[14px] text-right rounded-[10px] border-none outline-none px-[15px] placeholder:text-white/30"
                  />
                </div>
              </div>

              {/* Phone */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[14px] font-medium text-white text-right">מספר טלפון</label>
                <div className="border border-[#727BA0] rounded-[10px] h-[50px]">
                  <Input
                    type="tel"
                    value={newUserPhone}
                    onChange={(e) => setNewUserPhone(e.target.value)}
                    placeholder="050-0000000"
                    className="w-full h-full bg-transparent text-white text-[14px] text-right rounded-[10px] border-none outline-none px-[15px] placeholder:text-white/30"
                  />
                </div>
              </div>

              {/* Avatar Upload */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[14px] font-medium text-white text-right">תמונת פרופיל</label>
                <div className="flex items-center gap-[10px]">
                  {/* Preview */}
                  <div className="w-[50px] h-[50px] rounded-full bg-[#4A56D4] flex items-center justify-center overflow-hidden flex-shrink-0">
                    {newUserAvatarUrl ? (
                      <Image
                        src={newUserAvatarUrl}
                        alt="תצוגה מקדימה"
                        className="w-full h-full object-cover"
                        width={50}
                        height={50}
                        unoptimized
                      />
                    ) : (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-white/50">
                        <path d="M20 21V19C20 17.9391 19.5786 16.9217 18.8284 16.1716C18.0783 15.4214 17.0609 15 16 15H8C6.93913 15 5.92172 15.4214 5.17157 16.1716C4.42143 16.9217 4 17.9391 4 19V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="2"/>
                      </svg>
                    )}
                  </div>
                  {/* Upload Button */}
                  <input
                    ref={newAvatarInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleNewAvatarUpload}
                    title="העלה תמונת פרופיל"
                    aria-label="העלה תמונת פרופיל"
                    className="hidden"
                  />
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => newAvatarInputRef.current?.click()}
                    disabled={isUploadingNewAvatar}
                    className="flex-1 border border-[#727BA0] rounded-[10px] h-[50px] flex items-center justify-center gap-[8px] text-white/70 hover:text-white hover:border-white/50 transition-colors disabled:opacity-50"
                  >
                    {isUploadingNewAvatar ? (
                      <>
                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                        </svg>
                        מעלה...
                      </>
                    ) : (
                      <>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                          <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                          <path d="M17 8L12 3L7 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M12 3V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        </svg>
                        העלה תמונה
                      </>
                    )}
                  </Button>
                  {newUserAvatarUrl && (
                    <Button
                      variant="ghost"
                      size="icon"
                      type="button"
                      onClick={() => setNewUserAvatarUrl("")}
                      className="w-[50px] h-[50px] border border-[#F64E60]/50 rounded-[10px] flex items-center justify-center text-[#F64E60] hover:bg-[#F64E60]/20 transition-colors"
                      title="הסר תמונה"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                        <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    </Button>
                  )}
                </div>
              </div>

              {/* Admin Checkbox */}
              <label className="flex items-center justify-between bg-[#4A56D4]/30 rounded-[10px] p-[12px] cursor-pointer flex-row-reverse">
                <div className="relative inline-flex items-center">
                  <input
                    type="checkbox"
                    checked={newUserIsAdmin}
                    onChange={(e) => setNewUserIsAdmin(e.target.checked)}
                    title="הרשאות אדמין"
                    aria-label="הרשאות אדמין"
                    className="sr-only peer"
                  />
                  <div className="w-[44px] h-[24px] bg-[#4C526B] rounded-full peer peer-checked:bg-[#3CD856] after:content-[''] after:absolute after:top-[2px] after:right-[2px] after:bg-white after:rounded-full after:h-[20px] after:w-[20px] after:transition-all peer-checked:after:translate-x-[-20px]"></div>
                </div>
                <span className="text-[14px] font-medium text-white">הרשאות אדמין</span>
              </label>

              {/* Business Assignment (Optional) */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[14px] font-medium text-white text-right">שיוך לעסק (אופציונלי)</label>
                <Select value={newUserBusinessId || "__none__"} onValueChange={(val) => setNewUserBusinessId(val === "__none__" ? "" : val)}>
                  <SelectTrigger className="w-full bg-[#0F1535] border border-[#727BA0] rounded-[10px] h-[50px] px-[12px] text-[14px] text-white text-right">
                    <SelectValue placeholder="בחר עסק לשיוך" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">ללא שיוך לעסק</SelectItem>
                    {businesses.map((business) => (
                      <SelectItem key={business.id} value={business.id}>
                        {business.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Role (only if business selected) */}
              {newUserBusinessId && (
                <div className="flex flex-col gap-[5px]">
                  <label className="text-[14px] font-medium text-white text-right">תפקיד בעסק</label>
                  <Select value={newUserRole} onValueChange={(val) => setNewUserRole(val as "owner" | "manager" | "employee")}>
                    <SelectTrigger className="w-full bg-[#0F1535] border border-[#727BA0] rounded-[10px] h-[50px] px-[12px] text-[14px] text-white text-right">
                      <SelectValue placeholder="בחר תפקיד" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="owner">בעלים</SelectItem>
                      <SelectItem value="manager">מנהל</SelectItem>
                      <SelectItem value="employee">עובד</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Error */}
              {createError && (
                <div className="bg-[#F64E60]/20 rounded-[10px] p-[12px]">
                  <p className="text-[13px] text-[#F64E60] text-right">{createError}</p>
                </div>
              )}

              {/* Buttons */}
              <div className="flex gap-[10px] mt-[10px]">
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => setIsCreateDialogOpen(false)}
                  className="flex-1 bg-transparent border border-[#727BA0] text-white text-[14px] font-semibold py-[12px] rounded-[10px] transition-colors hover:bg-white/10"
                >
                  ביטול
                </Button>
                <Button
                  variant="default"
                  type="button"
                  onClick={handleCreateUser}
                  disabled={!newUserEmail.trim() || !newUserPassword.trim() || isSubmitting}
                  className="flex-1 bg-[#3CD856] text-white text-[14px] font-semibold py-[12px] rounded-[10px] transition-colors hover:bg-[#2fb847] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-[6px]"
                >
                  {isSubmitting ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      מוסיף...
                    </>
                  ) : (
                    "הוסף משתמש"
                  )}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Edit User Dialog */}
      {isEditDialogOpen && editingUser && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-[2001]"
            onClick={() => setIsEditDialogOpen(false)}
          />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-40px)] max-w-[400px] bg-[#0F1535] rounded-[20px] p-[25px] z-[2002] shadow-[0_10px_40px_rgba(0,0,0,0.5)] border border-white/10 max-h-[90vh] overflow-y-auto">
            {/* Dialog Header */}
            <div className="flex items-center justify-between mb-[20px] flex-row-reverse">
              <Button
                variant="ghost"
                size="icon"
                type="button"
                onClick={() => setIsEditDialogOpen(false)}
                title="סגור"
                aria-label="סגור חלון"
                className="w-[32px] h-[32px] flex items-center justify-center text-white/70 hover:text-white transition-colors"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </Button>
              <h2 className="text-[20px] font-bold text-white">עריכת משתמש</h2>
            </div>

            {/* User Info Header */}
            <div className="flex items-center gap-[12px] mb-[20px] bg-[#4A56D4]/20 rounded-[10px] p-[12px]">
              <div className="w-[50px] h-[50px] rounded-full bg-[#4A56D4] flex items-center justify-center overflow-hidden flex-shrink-0">
                {editingUser.avatar_url ? (
                  <Image
                    src={editingUser.avatar_url}
                    alt={editingUser.full_name || "User"}
                    className="w-full h-full object-cover"
                    width={50}
                    height={50}
                    unoptimized
                  />
                ) : (
                  <span className="text-white text-[20px] font-bold">
                    {(editingUser.full_name || editingUser.email || "?")[0].toUpperCase()}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-bold text-white truncate">{editingUser.email}</p>
                <p className="text-[12px] text-white/60">ID: {editingUser.id.slice(0, 8)}...</p>
              </div>
            </div>

            {/* Form */}
            <div className="flex flex-col gap-[15px]">
              {/* Name */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[14px] font-medium text-white text-right">שם מלא</label>
                <div className="border border-[#727BA0] rounded-[10px] h-[50px]">
                  <Input
                    type="text"
                    value={editUserName}
                    onChange={(e) => setEditUserName(e.target.value)}
                    placeholder="שם המשתמש"
                    className="w-full h-full bg-transparent text-white text-[14px] text-right rounded-[10px] border-none outline-none px-[15px] placeholder:text-white/30"
                  />
                </div>
              </div>

              {/* Phone */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[14px] font-medium text-white text-right">מספר טלפון</label>
                <div className="border border-[#727BA0] rounded-[10px] h-[50px]">
                  <Input
                    type="tel"
                    value={editUserPhone}
                    onChange={(e) => setEditUserPhone(e.target.value)}
                    placeholder="050-0000000"
                    className="w-full h-full bg-transparent text-white text-[14px] text-right rounded-[10px] border-none outline-none px-[15px] placeholder:text-white/30"
                  />
                </div>
              </div>

              {/* Avatar Upload */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[14px] font-medium text-white text-right">תמונת פרופיל</label>
                <div className="flex items-center gap-[10px]">
                  {/* Preview */}
                  <div className="w-[50px] h-[50px] rounded-full bg-[#4A56D4] flex items-center justify-center overflow-hidden flex-shrink-0">
                    {editUserAvatarUrl ? (
                      <Image
                        src={editUserAvatarUrl}
                        alt="תצוגה מקדימה"
                        className="w-full h-full object-cover"
                        width={50}
                        height={50}
                        unoptimized
                      />
                    ) : (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-white/50">
                        <path d="M20 21V19C20 17.9391 19.5786 16.9217 18.8284 16.1716C18.0783 15.4214 17.0609 15 16 15H8C6.93913 15 5.92172 15.4214 5.17157 16.1716C4.42143 16.9217 4 17.9391 4 19V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="2"/>
                      </svg>
                    )}
                  </div>
                  {/* Upload Button */}
                  <input
                    ref={editAvatarInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleEditAvatarUpload}
                    title="העלה תמונת פרופיל"
                    aria-label="העלה תמונת פרופיל"
                    className="hidden"
                  />
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => editAvatarInputRef.current?.click()}
                    disabled={isUploadingEditAvatar}
                    className="flex-1 border border-[#727BA0] rounded-[10px] h-[50px] flex items-center justify-center gap-[8px] text-white/70 hover:text-white hover:border-white/50 transition-colors disabled:opacity-50"
                  >
                    {isUploadingEditAvatar ? (
                      <>
                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                        </svg>
                        מעלה...
                      </>
                    ) : (
                      <>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                          <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                          <path d="M17 8L12 3L7 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M12 3V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        </svg>
                        העלה תמונה
                      </>
                    )}
                  </Button>
                  {editUserAvatarUrl && (
                    <Button
                      variant="ghost"
                      size="icon"
                      type="button"
                      onClick={() => setEditUserAvatarUrl("")}
                      className="w-[50px] h-[50px] border border-[#F64E60]/50 rounded-[10px] flex items-center justify-center text-[#F64E60] hover:bg-[#F64E60]/20 transition-colors"
                      title="הסר תמונה"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                        <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    </Button>
                  )}
                </div>
              </div>

              {/* New Password */}
              <div className="flex flex-col gap-[5px]">
                <label className="text-[14px] font-medium text-white text-right">סיסמה חדשה (השאר ריק לשמירת הקיימת)</label>
                <div className="border border-[#727BA0] rounded-[10px] h-[50px]">
                  <Input
                    type="password"
                    value={editUserNewPassword}
                    onChange={(e) => setEditUserNewPassword(e.target.value)}
                    placeholder="לפחות 6 תווים"
                    className="w-full h-full bg-transparent text-white text-[14px] text-right rounded-[10px] border-none outline-none px-[15px] placeholder:text-white/30"
                  />
                </div>
              </div>

              {/* Admin Checkbox */}
              <label className="flex items-center justify-between bg-[#4A56D4]/30 rounded-[10px] p-[12px] cursor-pointer flex-row-reverse">
                <div className="relative inline-flex items-center">
                  <input
                    type="checkbox"
                    checked={editUserIsAdmin}
                    onChange={(e) => setEditUserIsAdmin(e.target.checked)}
                    title="הרשאות אדמין"
                    aria-label="הרשאות אדמין"
                    className="sr-only peer"
                  />
                  <div className="w-[44px] h-[24px] bg-[#4C526B] rounded-full peer peer-checked:bg-[#3CD856] after:content-[''] after:absolute after:top-[2px] after:right-[2px] after:bg-white after:rounded-full after:h-[20px] after:w-[20px] after:transition-all peer-checked:after:translate-x-[-20px]"></div>
                </div>
                <span className="text-[14px] font-medium text-white">הרשאות אדמין</span>
              </label>

              {/* Error */}
              {editError && (
                <div className="bg-[#F64E60]/20 rounded-[10px] p-[12px]">
                  <p className="text-[13px] text-[#F64E60] text-right">{editError}</p>
                </div>
              )}

              {/* Buttons */}
              <div className="flex gap-[10px] mt-[10px]">
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => setIsEditDialogOpen(false)}
                  className="flex-1 bg-transparent border border-[#727BA0] text-white text-[14px] font-semibold py-[12px] rounded-[10px] transition-colors hover:bg-white/10"
                >
                  ביטול
                </Button>
                <Button
                  variant="default"
                  type="button"
                  onClick={handleUpdateUser}
                  disabled={isSubmitting}
                  className="flex-1 bg-[#3CD856] text-white text-[14px] font-semibold py-[12px] rounded-[10px] transition-colors hover:bg-[#2fb847] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-[6px]"
                >
                  {isSubmitting ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      שומר...
                    </>
                  ) : (
                    "שמור שינויים"
                  )}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
