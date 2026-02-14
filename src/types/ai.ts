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
