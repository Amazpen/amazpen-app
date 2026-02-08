"use client";

import { useDashboard } from "../layout";
import { AiChatContainer } from "@/components/ai/AiChatContainer";

export default function AiPage() {
  const { isAdmin, selectedBusinesses } = useDashboard();
  const businessId = selectedBusinesses[0];

  return <AiChatContainer isAdmin={isAdmin} businessId={businessId} />;
}
