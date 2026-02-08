export interface AiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  chartData?: AiChartData;
}

export interface AiChartData {
  type: "bar" | "area";
  title: string;
  data: Array<Record<string, string | number>>;
  dataKeys: AiChartDataKey[];
  xAxisKey: string;
}

export interface AiChartDataKey {
  key: string;
  label: string;
  color: string;
}

export interface AiSuggestedQuestion {
  text: string;
  icon: "revenue" | "expenses" | "comparison" | "targets" | "summary" | "general";
}

export interface AiChatRequest {
  message: string;
  businessId: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface AiChatResponse {
  content: string;
  chartData?: AiChartData;
  error?: string;
}
