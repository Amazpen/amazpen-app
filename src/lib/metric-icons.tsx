import {
  ChartLineUpIcon as ChartLineUp,
  UsersThreeIcon as UsersThree,
  CookingPotIcon as CookingPot,
  ReceiptIcon as Receipt,
  MopedFrontIcon as MopedFront,
  PackageIcon as Package,
  TrophyIcon as Trophy,
  ArrowsLeftRightIcon as ArrowsLeftRight,
  WalletIcon as Wallet,
  PresentationChartIcon as PresentationChart,
  LightbulbFilamentIcon as LightbulbFilament,
  GearSixIcon as GearSix,
} from "@phosphor-icons/react";

export const METRIC_ICONS = {
  totalIncome:     { Icon: ChartLineUp, color: 'icon-bg-green' },
  laborCost:       { Icon: UsersThree, color: 'icon-bg-purple' },
  foodCost:        { Icon: CookingPot, color: 'icon-bg-orange' },
  currentExpenses: { Icon: Receipt, color: 'icon-bg-yellow' },
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

// Global palette for dynamic card color cycling — no two adjacent cards share a color
export const ICON_BG_PALETTE = [
  'icon-bg-green',
  'icon-bg-peach',
  'icon-bg-cyan',
  'icon-bg-purple',
  'icon-bg-orange',
  'icon-bg-blue',
  'icon-bg-pink',
  'icon-bg-yellow',
] as const;

/** Get icon background color by global card index — cycles through all 8 colors */
export function getIconBgColor(index: number): string {
  return ICON_BG_PALETTE[index % ICON_BG_PALETTE.length];
}

export function MetricIcon({ type, size = 31, colorOverride }: { type: MetricType; size?: number; colorOverride?: string }) {
  const { Icon, color } = METRIC_ICONS[type];
  const iconSize = Math.round(size * 0.58);
  return (
    <div
      className={`${colorOverride || color} rounded-full flex items-center justify-center`}
      style={{ width: size, height: size }}
    >
      <Icon size={iconSize} color="white" weight="duotone" />
    </div>
  );
}
