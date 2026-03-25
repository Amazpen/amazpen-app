"use client";

import { useState, useEffect } from "react";
import { useDashboard } from "../layout";
import { AiChatContainer } from "@/components/ai/AiChatContainer";
import { createClient } from "@/lib/supabase/client";

interface BusinessOption {
  id: string;
  name: string;
}

export default function AiPage() {
  const { isAdmin, selectedBusinesses, userAvatarUrl } = useDashboard();
  const [allBusinesses, setAllBusinesses] = useState<BusinessOption[]>([]);
  const [aiSelectedBusinessId, setAiSelectedBusinessId] = useState<string | undefined>(selectedBusinesses[0]);

  // For admin: fetch all businesses so they can pick which one to ask about
  useEffect(() => {
    if (!isAdmin) return;
    const supabase = createClient();
    supabase
      .from("businesses")
      .select("id, name")
      .eq("status", "active")
      .is("deleted_at", null)
      .order("name")
      .then(({ data }) => {
        if (data) setAllBusinesses(data);
      });
  }, [isAdmin]);

  // Sync with dashboard selection when it changes (non-admin always uses dashboard selection)
  useEffect(() => {
    if (!isAdmin) {
      setAiSelectedBusinessId(selectedBusinesses[0]);
    }
  }, [isAdmin, selectedBusinesses]);

  return (
    <AiChatContainer
      isAdmin={isAdmin}
      businessId={aiSelectedBusinessId}
      allBusinesses={isAdmin ? allBusinesses : undefined}
      onBusinessChange={isAdmin ? setAiSelectedBusinessId : undefined}
      userAvatarUrl={userAvatarUrl}
    />
  );
}
