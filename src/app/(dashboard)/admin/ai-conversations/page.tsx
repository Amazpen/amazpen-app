"use client";

import { useDashboard } from "../../layout";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";
import { Building2, User, MessageCircle, ChevronRight, ArrowRight, Search } from "lucide-react";
import Image from "next/image";

interface Business {
  id: string;
  name: string;
}

interface UserItem {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface Session {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

interface ChatMessage {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "הרגע";
  if (mins < 60) return `לפני ${mins} דק׳`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `לפני ${hours} שע׳`;
  const days = Math.floor(diff / 86400000);
  if (days < 7) return `לפני ${days} ימים`;
  return new Date(iso).toLocaleDateString("he-IL");
}

// AI bot icon (same as in chat)
function AiIcon() {
  return (
    <div className="flex-shrink-0 w-[28px] h-[28px] rounded-full overflow-hidden">
      <Image
        src="https://db.amazpenbiz.co.il/storage/v1/object/public/attachments/ai/ai-avatar.png"
        alt="דדי"
        width={28}
        height={28}
        className="w-full h-full object-cover"
        unoptimized
        loading="eager"
      />
    </div>
  );
}

export default function AdminAiConversationsPage() {
  const { isAdmin } = useDashboard();
  const router = useRouter();

  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserItem | null>(null);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);

  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Redirect non-admins
  useEffect(() => {
    if (isAdmin === false) router.push("/");
  }, [isAdmin, router]);

  // Load businesses on mount
  useEffect(() => {
    async function load() {
      setLoading(true);
      const res = await fetch("/api/admin/ai-sessions");
      if (res.ok) {
        const data = await res.json();
        setBusinesses(data.businesses || []);
      }
      setLoading(false);
    }
    load();
  }, []);

  // Load users when business selected
  const selectBusiness = useCallback(async (biz: Business) => {
    setSelectedBusiness(biz);
    setSelectedUser(null);
    setSelectedSession(null);
    setMessages([]);
    setSessions([]);
    setUsers([]);
    setLoading(true);
    const res = await fetch(`/api/admin/ai-sessions?businessId=${biz.id}`);
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users || []);
    }
    setLoading(false);
  }, []);

  // Load sessions when user selected
  const selectUser = useCallback(async (usr: UserItem) => {
    if (!selectedBusiness) return;
    setSelectedUser(usr);
    setSelectedSession(null);
    setMessages([]);
    setSessions([]);
    setLoading(true);
    const res = await fetch(`/api/admin/ai-sessions?businessId=${selectedBusiness.id}&userId=${usr.id}`);
    if (res.ok) {
      const data = await res.json();
      setSessions(data.sessions || []);
    }
    setLoading(false);
  }, [selectedBusiness]);

  // Load messages when session selected
  const selectSession = useCallback(async (session: Session) => {
    setSelectedSession(session);
    setMessages([]);
    setLoading(true);
    const res = await fetch(`/api/admin/ai-sessions/${session.id}/messages`);
    if (res.ok) {
      const data = await res.json();
      setMessages(data.messages || []);
    }
    setLoading(false);
    // Scroll to bottom after messages load
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }, []);

  // Go back navigation
  const goBack = useCallback(() => {
    if (selectedSession) {
      setSelectedSession(null);
      setMessages([]);
    } else if (selectedUser) {
      setSelectedUser(null);
      setSessions([]);
    } else if (selectedBusiness) {
      setSelectedBusiness(null);
      setUsers([]);
    }
  }, [selectedSession, selectedUser, selectedBusiness]);

  // Filter items based on search
  const filteredBusinesses = businesses.filter(b =>
    b.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredUsers = users.filter(u =>
    u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!isAdmin) return null;

  // Breadcrumb path
  const breadcrumbs: string[] = ["שיחות AI"];
  if (selectedBusiness) breadcrumbs.push(selectedBusiness.name);
  if (selectedUser) breadcrumbs.push(selectedUser.name);
  if (selectedSession) breadcrumbs.push(selectedSession.title || "שיחה");

  return (
    <div className="flex flex-col h-[calc(100vh-70px)] sm:h-[calc(100vh-66px)] overflow-hidden bg-[#0F1535]" dir="rtl">
      {/* Header */}
      <div className="flex-shrink-0 bg-[#0F1535] border-b border-white/10 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {(selectedBusiness || selectedUser || selectedSession) && (
              <button
                type="button"
                onClick={goBack}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              >
                <ArrowRight className="w-4 h-4 text-white/60" />
              </button>
            )}
            <div className="flex items-center gap-1.5 text-[13px]">
              {breadcrumbs.map((crumb, i) => (
                <span key={i} className="flex items-center gap-1.5">
                  {i > 0 && <ChevronRight className="w-3 h-3 text-white/30" />}
                  <span className={i === breadcrumbs.length - 1 ? "text-white font-medium" : "text-white/50"}>
                    {crumb}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Chat view */}
      {selectedSession && messages.length > 0 ? (
        <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 space-y-3 scrollbar-thin">
          {/* Session info */}
          <div className="text-center mb-4">
            <span className="text-[11px] text-white/30 bg-white/5 px-3 py-1 rounded-full">
              {selectedSession.title || "שיחה"} — {formatDate(selectedSession.created_at)}
            </span>
          </div>
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"} gap-1`}
            >
              <div className={`flex items-start gap-2 ${msg.role === "user" ? "flex-row-reverse" : ""} w-full ${msg.role === "user" ? "justify-start" : ""}`}>
                {msg.role === "user" ? (
                  <div className="flex-shrink-0 w-[28px] h-[28px] rounded-full bg-[#6366f1] flex items-center justify-center">
                    <User className="w-3.5 h-3.5 text-white" />
                  </div>
                ) : (
                  <AiIcon />
                )}
                <div
                  className={`max-w-[85%] sm:max-w-[75%] text-white text-[13px] sm:text-[14px] leading-relaxed px-3 sm:px-4 py-2.5 rounded-[16px] break-words whitespace-pre-wrap [overflow-wrap:anywhere] ${
                    msg.role === "user"
                      ? "bg-[#6366f1] rounded-tr-[4px]"
                      : "bg-[#29318A] rounded-tr-[4px]"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
              <span className={`text-[10px] text-white/20 px-1 ${msg.role === "user" ? "mr-[36px]" : "mr-[36px]"}`}>
                {formatDate(msg.created_at)}
              </span>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
      ) : (
        /* List view — businesses / users / sessions */
        <div className="flex-1 overflow-y-auto">
          {/* Search bar (for businesses and users lists) */}
          {!selectedSession && (
            <div className="px-4 py-3 border-b border-white/5">
              <div className="flex items-center gap-2 bg-white/5 rounded-[10px] px-3 py-2">
                <Search className="w-3.5 h-3.5 text-white/40 flex-shrink-0" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={selectedBusiness ? "חפש משתמש..." : "חפש עסק..."}
                  className="bg-transparent text-white text-[13px] placeholder:text-white/30 outline-none w-full"
                  dir="rtl"
                />
              </div>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-white/20 border-t-indigo-400 rounded-full animate-spin" />
            </div>
          )}

          {/* Business list */}
          {!selectedBusiness && !loading && (
            <div className="divide-y divide-white/5">
              {filteredBusinesses.map((biz) => (
                <button
                  key={biz.id}
                  type="button"
                  onClick={() => { setSearchQuery(""); selectBusiness(biz); }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <div className="w-[36px] h-[36px] rounded-[10px] bg-indigo-500/20 flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-4 h-4 text-indigo-400" />
                  </div>
                  <div className="flex-1 text-right">
                    <p className="text-[14px] text-white font-medium">{biz.name}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-white/20 rotate-180" />
                </button>
              ))}
              {filteredBusinesses.length === 0 && (
                <p className="text-center text-white/30 text-[13px] py-8">
                  {searchQuery ? "לא נמצאו עסקים" : "אין עסקים במערכת"}
                </p>
              )}
            </div>
          )}

          {/* Users list */}
          {selectedBusiness && !selectedUser && !loading && (
            <div className="divide-y divide-white/5">
              {filteredUsers.map((usr) => (
                <button
                  key={usr.id}
                  type="button"
                  onClick={() => { setSearchQuery(""); selectUser(usr); }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <div className="w-[36px] h-[36px] rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4 text-white/60" />
                  </div>
                  <div className="flex-1 text-right">
                    <p className="text-[14px] text-white font-medium">{usr.name}</p>
                    <p className="text-[11px] text-white/40">{usr.email} — {usr.role === "admin" ? "אדמין" : usr.role === "owner" ? "בעלים" : "עובד"}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-white/20 rotate-180" />
                </button>
              ))}
              {filteredUsers.length === 0 && (
                <p className="text-center text-white/30 text-[13px] py-8">
                  {searchQuery ? "לא נמצאו משתמשים" : "אין משתמשים בעסק זה"}
                </p>
              )}
            </div>
          )}

          {/* Sessions list */}
          {selectedUser && !selectedSession && !loading && (
            <div className="divide-y divide-white/5">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => selectSession(session)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <div className="w-[36px] h-[36px] rounded-[10px] bg-[#29318A]/50 flex items-center justify-center flex-shrink-0">
                    <MessageCircle className="w-4 h-4 text-indigo-400" />
                  </div>
                  <div className="flex-1 text-right">
                    <p className="text-[14px] text-white font-medium">{session.title || "שיחה ללא כותרת"}</p>
                    <p className="text-[11px] text-white/40">{formatTimeAgo(session.updated_at)}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-white/20 rotate-180" />
                </button>
              ))}
              {sessions.length === 0 && (
                <p className="text-center text-white/30 text-[13px] py-8">אין שיחות AI למשתמש זה</p>
              )}
            </div>
          )}

          {/* Empty session messages */}
          {selectedSession && messages.length === 0 && !loading && (
            <p className="text-center text-white/30 text-[13px] py-8">אין הודעות בשיחה זו</p>
          )}
        </div>
      )}
    </div>
  );
}
