import {
  TrendUp,
  UsersThree,
  ShoppingCart,
  Buildings,
  Moped,
  Truck,
  Target,
  ArrowsLeftRight,
  CreditCard,
  ChartBar,
  Lightbulb,
  GearSix,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";

export const METRIC_ICONS = {
  totalIncome:     { Icon: TrendUp, color: 'icon-bg-green' },
  laborCost:       { Icon: UsersThree, color: 'icon-bg-purple' },
  foodCost:        { Icon: ShoppingCart, color: 'icon-bg-orange' },
  currentExpenses: { Icon: Buildings, color: 'icon-bg-peach' },
  deliveries:      { Icon: Moped, color: 'icon-bg-yellow' },
  suppliers:       { Icon: Truck, color: 'icon-bg-orange' },
  goals:           { Icon: Target, color: 'icon-bg-green' },
  cashflow:        { Icon: ArrowsLeftRight, color: 'icon-bg-blue' },
  payments:        { Icon: CreditCard, color: 'icon-bg-pink' },
  reports:         { Icon: ChartBar, color: 'icon-bg-peach' },
  insights:        { Icon: Lightbulb, color: 'icon-bg-green' },
  operations:      { Icon: GearSix, color: 'icon-bg-peach' },
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
      <Icon size={iconSize} color="white" weight="duotone" />
    </div>
  );
}
