import {
  TrendingUp,
  Users,
  ShoppingCart,
  Building2,
  Bike,
  Truck,
  Target,
  ArrowLeftRight,
  CreditCard,
  BarChart3,
  Lightbulb,
  Settings,
} from "lucide-react";

export const METRIC_ICONS = {
  totalIncome:     { Icon: TrendingUp, color: 'icon-bg-green' },
  laborCost:       { Icon: Users, color: 'icon-bg-purple' },
  foodCost:        { Icon: ShoppingCart, color: 'icon-bg-orange' },
  currentExpenses: { Icon: Building2, color: 'icon-bg-peach' },
  deliveries:      { Icon: Bike, color: 'icon-bg-yellow' },
  suppliers:       { Icon: Truck, color: 'icon-bg-orange' },
  goals:           { Icon: Target, color: 'icon-bg-green' },
  cashflow:        { Icon: ArrowLeftRight, color: 'icon-bg-blue' },
  payments:        { Icon: CreditCard, color: 'icon-bg-pink' },
  reports:         { Icon: BarChart3, color: 'icon-bg-peach' },
  insights:        { Icon: Lightbulb, color: 'icon-bg-green' },
  operations:      { Icon: Settings, color: 'icon-bg-peach' },
} as const;

export type MetricType = keyof typeof METRIC_ICONS;

export function MetricIcon({ type, size = 31 }: { type: MetricType; size?: number }) {
  const { Icon, color } = METRIC_ICONS[type];
  const iconSize = Math.round(size * 0.58);
  return (
    <div
      className={`${color} rounded-full flex items-center justify-center`}
      style={{ width: size, height: size }}
    >
      <Icon size={iconSize} className="text-white" strokeWidth={2} />
    </div>
  );
}
