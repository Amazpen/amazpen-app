"use client";

import { useDashboard } from "../layout";
import { AiChatContainer } from "@/components/ai/AiChatContainer";

export default function AiPage() {
  const { isAdmin } = useDashboard();

  return <AiChatContainer isAdmin={isAdmin} />;
}
