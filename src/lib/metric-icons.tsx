import {
  ChartLineUp,
  UsersThree,
  CookingPot,
  Receipt,
  MopedFront,
  Package,
  Trophy,
  ArrowsLeftRight,
  Wallet,
  PresentationChart,
  LightbulbFilament,
  GearSix,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";

export const METRIC_ICONS = {
  totalIncome:     { Icon: ChartLineUp, color: 'icon-bg-green' },
  laborCost:       { Icon: UsersThree, color: 'icon-bg-purple' },
  foodCost:        { Icon: CookingPot, color: 'icon-bg-orange' },
  currentExpenses: { Icon: Receipt, color: 'icon-bg-peach' },
  deliveries:      { Icon: MopedFront, color: 'icon-bg-yellow' },
  suppliers:       { Icon: Package, color: 'icon-bg-orange' },
  goals:           { Icon: Trophy, color: 'icon-bg-green' },
  cashflow:        { Icon: ArrowsLeftRight, color: 'icon-bg-blue' },
  payments:        { Icon: Wallet, color: 'icon-bg-pink' },
  reports:         { Icon: PresentationChart, color: 'icon-bg-peach' },
  insights:        { Icon: LightbulbFilament, color: 'icon-bg-green' },
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
