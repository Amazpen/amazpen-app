"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PaymentMethodType, SettlementType, SettlementPeriod } from "@/types";
import { Plus, Trash2 } from "lucide-react";

interface PaymentMethodSettlementEditorProps {
  method: PaymentMethodType;
  open: boolean;
  onClose: () => void;
  onSave: (updated: Partial<PaymentMethodType>) => void;
}

const settlementTypeLabels: Record<SettlementType, string> = {
  same_day: "באותו יום",
  daily: "יומי (עם עיכוב)",
  weekly: "שבועי",
  monthly: "חודשי",
  bimonthly: "דו-חודשי",
  custom: "מותאם (קופונים)",
  custom_periods: "תקופות מותאמות (וולט/תן ביס)",
};

const dayOfWeekLabels = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

const DEFAULT_PERIOD: SettlementPeriod = {
  range_start: 1,
  range_end: 7,
  settlement_date: 8,
  commission_rate: 0,
  commission_type: "percentage",
};

export function PaymentMethodSettlementEditor({ method, open, onClose, onSave }: PaymentMethodSettlementEditorProps) {
  const [settlementType, setSettlementType] = useState<SettlementType>((method.settlement_type as SettlementType) || "daily");
  const [delayDays, setDelayDays] = useState(method.settlement_delay_days ?? 1);
  const [dayOfWeek, setDayOfWeek] = useState(method.settlement_day_of_week ?? 0);
  const [dayOfMonth, setDayOfMonth] = useState(method.settlement_day_of_month ?? 1);
  const [bimonthlyFirstCutoff, setBimonthlyFirstCutoff] = useState(method.bimonthly_first_cutoff ?? 14);
  const [bimonthlyFirstSettlement, setBimonthlyFirstSettlement] = useState(method.bimonthly_first_settlement ?? 2);
  const [bimonthlySecondSettlement, setBimonthlySecondSettlement] = useState(method.bimonthly_second_settlement ?? 8);
  const [commissionRate, setCommissionRate] = useState(Number(method.commission_rate) ?? 0);
  const [couponSettlementDate, setCouponSettlementDate] = useState(method.coupon_settlement_date ?? 1);
  const [couponRangeStart, setCouponRangeStart] = useState(method.coupon_range_start ?? 1);
  const [couponRangeEnd, setCouponRangeEnd] = useState(method.coupon_range_end ?? 31);

  // Custom periods state
  const [periods, setPeriods] = useState<SettlementPeriod[]>(
    (method.settlement_periods as SettlementPeriod[] | null) || [
      { range_start: 1, range_end: 7, settlement_date: 8, commission_rate: 0, commission_type: "percentage" },
      { range_start: 8, range_end: 14, settlement_date: 15, commission_rate: 0, commission_type: "percentage" },
      { range_start: 15, range_end: 21, settlement_date: 22, commission_rate: 0, commission_type: "percentage" },
      { range_start: 22, range_end: 28, settlement_date: 29, commission_rate: 0, commission_type: "percentage" },
    ]
  );

  const handleSave = () => {
    const base: Partial<PaymentMethodType> = {
      settlement_type: settlementType,
      settlement_delay_days: delayDays,
      settlement_day_of_week: settlementType === "weekly" ? dayOfWeek : undefined,
      settlement_day_of_month: settlementType === "monthly" ? dayOfMonth : undefined,
      bimonthly_first_cutoff: settlementType === "bimonthly" ? bimonthlyFirstCutoff : undefined,
      bimonthly_first_settlement: settlementType === "bimonthly" ? bimonthlyFirstSettlement : undefined,
      bimonthly_second_settlement: settlementType === "bimonthly" ? bimonthlySecondSettlement : undefined,
      commission_rate: settlementType === "custom_periods" ? 0 : commissionRate,
      coupon_settlement_date: settlementType === "custom" ? couponSettlementDate : undefined,
      coupon_range_start: settlementType === "custom" ? couponRangeStart : undefined,
      coupon_range_end: settlementType === "custom" ? couponRangeEnd : undefined,
      settlement_periods: settlementType === "custom_periods" ? periods : null,
    };
    onSave(base);
    onClose();
  };

  const updatePeriod = (index: number, field: keyof SettlementPeriod, value: number | string) => {
    setPeriods(prev => prev.map((p, i) => i === index ? { ...p, [field]: value } : p));
  };

  const addPeriod = () => {
    const last = periods[periods.length - 1];
    const nextStart = last ? last.range_end + 1 : 1;
    setPeriods(prev => [...prev, {
      ...DEFAULT_PERIOD,
      range_start: nextStart,
      range_end: Math.min(nextStart + 6, 31),
      settlement_date: Math.min(nextStart + 7, 31),
    }]);
  };

  const removePeriod = (index: number) => {
    if (periods.length <= 1) return;
    setPeriods(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className={`bg-[#0f1535] border-[#4C526B] text-white rounded-[20px] p-[20px] ${settlementType === "custom_periods" ? "sm:max-w-[600px]" : "sm:max-w-[420px]"}`} dir="rtl">
        <DialogHeader className="border-b border-[#4C526B] pb-[14px]">
          <DialogTitle className="text-right text-[18px] font-bold text-white">
            הגדרות תקבול — {method.name}
          </DialogTitle>
          <DialogDescription className="text-[12px] text-white/40 text-right">
            הגדר מתי הכסף מ{method.name} נכנס לחשבון הבנק
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-[15px] max-h-[70vh] overflow-y-auto">
          {/* Settlement Type */}
          <div className="flex flex-col gap-[6px]">
            <label className="text-[13px] text-white/60 text-right">סוג התחשבנות</label>
            <Select value={settlementType} onValueChange={(v) => setSettlementType(v as SettlementType)}>
              <SelectTrigger className="w-full bg-[#0f1535] border-[#4C526B] text-white text-right h-[44px] rounded-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#0f1535] border-[#4C526B]">
                {(Object.entries(settlementTypeLabels) as [SettlementType, string][]).map(([value, label]) => (
                  <SelectItem key={value} value={value} className="text-white text-right">
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Daily: delay days */}
          {(settlementType === "daily" || settlementType === "same_day") && (
            <div className="flex flex-col gap-[6px]">
              <label className="text-[13px] text-white/60 text-right">עיכוב בימים</label>
              <Input
                type="number"
                min={0}
                max={30}
                value={settlementType === "same_day" ? 0 : delayDays}
                onChange={(e) => setDelayDays(parseInt(e.target.value) || 0)}
                disabled={settlementType === "same_day"}
                className="bg-[#0f1535] border-[#4C526B] text-white text-center h-[44px] rounded-[10px]"
              />
              <p className="text-[11px] text-white/40 text-right">
                {settlementType === "same_day" ? "נכנס באותו יום" : `נכנס ${delayDays} ימים אחרי הרישום`}
              </p>
            </div>
          )}

          {/* Weekly: day of week */}
          {settlementType === "weekly" && (
            <div className="flex flex-col gap-[6px]">
              <label className="text-[13px] text-white/60 text-right">יום תקבול בשבוע</label>
              <Select value={String(dayOfWeek)} onValueChange={(v) => setDayOfWeek(parseInt(v))}>
                <SelectTrigger className="w-full bg-[#0f1535] border-[#4C526B] text-white text-right h-[44px] rounded-[10px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0f1535] border-[#4C526B]">
                  {dayOfWeekLabels.map((label, i) => (
                    <SelectItem key={i} value={String(i)} className="text-white text-right">
                      יום {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Monthly: day of month */}
          {settlementType === "monthly" && (
            <div className="flex flex-col gap-[6px]">
              <label className="text-[13px] text-white/60 text-right">יום תקבול בחודש</label>
              <Input
                type="number"
                min={1}
                max={31}
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(parseInt(e.target.value) || 1)}
                className="bg-[#0f1535] border-[#4C526B] text-white text-center h-[44px] rounded-[10px]"
              />
            </div>
          )}

          {/* Bimonthly: cutoff + 2 settlement days */}
          {settlementType === "bimonthly" && (
            <>
              <div className="flex flex-col gap-[6px]">
                <label className="text-[13px] text-white/60 text-right">תאריך חיתוך (תקופה ראשונה עד יום)</label>
                <Input
                  type="number"
                  min={1}
                  max={28}
                  value={bimonthlyFirstCutoff}
                  onChange={(e) => setBimonthlyFirstCutoff(parseInt(e.target.value) || 14)}
                  className="bg-[#0f1535] border-[#4C526B] text-white text-center h-[44px] rounded-[10px]"
                />
                <p className="text-[11px] text-white/40 text-right">
                  הכנסות מ-1 עד {bimonthlyFirstCutoff} לחודש &larr; נכנסות ב-{bimonthlyFirstSettlement} לחודש הבא
                </p>
              </div>
              <div className="flex gap-[10px]">
                <div className="flex-1 flex flex-col gap-[6px]">
                  <label className="text-[13px] text-white/60 text-right">יום תשלום 1</label>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={bimonthlyFirstSettlement}
                    onChange={(e) => setBimonthlyFirstSettlement(parseInt(e.target.value) || 2)}
                    className="bg-[#0f1535] border-[#4C526B] text-white text-center h-[44px] rounded-[10px]"
                  />
                </div>
                <div className="flex-1 flex flex-col gap-[6px]">
                  <label className="text-[13px] text-white/60 text-right">יום תשלום 2</label>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={bimonthlySecondSettlement}
                    onChange={(e) => setBimonthlySecondSettlement(parseInt(e.target.value) || 8)}
                    className="bg-[#0f1535] border-[#4C526B] text-white text-center h-[44px] rounded-[10px]"
                  />
                </div>
              </div>
              <p className="text-[11px] text-white/40 text-right">
                הכנסות מ-{bimonthlyFirstCutoff + 1} עד סוף החודש &larr; נכנסות ב-{bimonthlySecondSettlement} לחודש הבא
              </p>
            </>
          )}

          {/* Custom (Coupons): settlement date + range */}
          {settlementType === "custom" && (
            <>
              <div className="flex flex-col gap-[6px]">
                <label className="text-[13px] text-white/60 text-right">יום כניסת הקופונים בחודש</label>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={couponSettlementDate}
                  onChange={(e) => setCouponSettlementDate(parseInt(e.target.value) || 1)}
                  className="bg-[#0f1535] border-[#4C526B] text-white text-center h-[44px] rounded-[10px]"
                />
              </div>
              <div className="flex gap-[10px]">
                <div className="flex-1 flex flex-col gap-[6px]">
                  <label className="text-[13px] text-white/60 text-right">מיום</label>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={couponRangeStart}
                    onChange={(e) => setCouponRangeStart(parseInt(e.target.value) || 1)}
                    className="bg-[#0f1535] border-[#4C526B] text-white text-center h-[44px] rounded-[10px]"
                  />
                </div>
                <div className="flex-1 flex flex-col gap-[6px]">
                  <label className="text-[13px] text-white/60 text-right">עד יום</label>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={couponRangeEnd}
                    onChange={(e) => setCouponRangeEnd(parseInt(e.target.value) || 31)}
                    className="bg-[#0f1535] border-[#4C526B] text-white text-center h-[44px] rounded-[10px]"
                  />
                </div>
              </div>
              <p className="text-[11px] text-white/40 text-right">
                כל הקופונים שנרשמו מ-{couponRangeStart} עד {couponRangeEnd} &larr; נכנסים ב-{couponSettlementDate} לחודש הבא
              </p>
            </>
          )}

          {/* Custom Periods (Wolt/10bis style): multiple settlement periods */}
          {settlementType === "custom_periods" && (
            <div className="flex flex-col gap-[10px]">
              <p className="text-[12px] text-white/50 text-right">
                הגדר תקופות התחשבנות — כל תקופה עם טווח תאריכים, תאריך קבלת כסף ועמלה
              </p>

              {/* Header */}
              <div className="grid grid-cols-[40px_1fr_1fr_1fr_1fr_80px_32px] gap-[6px] items-center text-[11px] text-white/50 text-center">
                <span>#</span>
                <span>מתאריך</span>
                <span>עד תאריך</span>
                <span>יום תקבול</span>
                <span>עמלה</span>
                <span>סוג עמלה</span>
                <span></span>
              </div>

              {/* Period rows */}
              {periods.map((period, idx) => (
                <div key={idx} className="grid grid-cols-[40px_1fr_1fr_1fr_1fr_80px_32px] gap-[6px] items-center">
                  <span className="text-[13px] text-white/40 text-center">{idx + 1}</span>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={period.range_start}
                    onChange={(e) => updatePeriod(idx, "range_start", parseInt(e.target.value) || 1)}
                    className="bg-[#0f1535] border-[#4C526B] text-white text-center h-[38px] rounded-[8px] text-[13px]"
                  />
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={period.range_end}
                    onChange={(e) => updatePeriod(idx, "range_end", parseInt(e.target.value) || 1)}
                    className="bg-[#0f1535] border-[#4C526B] text-white text-center h-[38px] rounded-[8px] text-[13px]"
                  />
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={period.settlement_date}
                    onChange={(e) => updatePeriod(idx, "settlement_date", parseInt(e.target.value) || 1)}
                    className="bg-[#0f1535] border-[#4C526B] text-white text-center h-[38px] rounded-[8px] text-[13px]"
                  />
                  <Input
                    type="number"
                    min={0}
                    max={10000}
                    step={0.01}
                    value={period.commission_rate}
                    onChange={(e) => updatePeriod(idx, "commission_rate", parseFloat(e.target.value) || 0)}
                    className="bg-[#0f1535] border-[#4C526B] text-white text-center h-[38px] rounded-[8px] text-[13px]"
                  />
                  <Select
                    value={period.commission_type}
                    onValueChange={(v) => updatePeriod(idx, "commission_type", v)}
                  >
                    <SelectTrigger className="bg-[#0f1535] border-[#4C526B] text-white h-[38px] rounded-[8px] text-[11px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0f1535] border-[#4C526B]">
                      <SelectItem value="percentage" className="text-white text-[12px]">%</SelectItem>
                      <SelectItem value="fixed" className="text-white text-[12px]">₪</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removePeriod(idx)}
                    disabled={periods.length <= 1}
                    className="h-[32px] w-[32px] text-red-400/60 hover:text-red-400 hover:bg-red-400/10"
                  >
                    <Trash2 className="w-[14px] h-[14px]" />
                  </Button>
                </div>
              ))}

              {/* Add period button */}
              <Button
                variant="ghost"
                onClick={addPeriod}
                className="text-[13px] text-[#4956D4] hover:text-white hover:bg-[#4956D4]/20 border border-dashed border-[#4C526B] rounded-[10px] h-[38px]"
              >
                <Plus className="w-[14px] h-[14px] ml-[6px]" />
                הוסף תקופה
              </Button>

              {/* Summary */}
              <div className="bg-[#4956D4]/10 rounded-[10px] p-[10px]">
                <p className="text-[11px] text-white/40 text-right mb-[4px]">סיכום תקופות:</p>
                {periods.map((p, i) => (
                  <p key={i} className="text-[12px] text-white/70 text-right">
                    {i + 1}. הכנסות מ-{p.range_start} עד {p.range_end} ← נכנסות ב-{p.settlement_date} לחודש
                    {p.commission_rate > 0 && (
                      <span className="text-yellow-400/70">
                        {" "}(עמלה: {p.commission_type === "percentage" ? `${p.commission_rate}%` : `₪${p.commission_rate}`})
                      </span>
                    )}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Commission Rate — shown for all types except custom_periods */}
          {settlementType !== "custom_periods" && (
            <div className="flex flex-col gap-[6px]">
              <label className="text-[13px] text-white/60 text-right">עמלת סליקה (%)</label>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={commissionRate}
                onChange={(e) => setCommissionRate(parseFloat(e.target.value) || 0)}
                className="bg-[#0f1535] border-[#4C526B] text-white text-center h-[44px] rounded-[10px]"
              />
              {commissionRate > 0 && (
                <p className="text-[11px] text-white/40 text-right">
                  ירד {commissionRate}% מכל הכנסה מ{method.name}
                </p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-[10px] pt-[5px]">
            <Button
              onClick={handleSave}
              className="flex-1 bg-[#4956D4] hover:bg-[#5A67E0] text-white text-[14px] font-semibold py-[10px] rounded-[10px]"
            >
              שמור
            </Button>
            <Button
              variant="ghost"
              onClick={onClose}
              className="flex-1 text-white/60 text-[14px] py-[10px] rounded-[10px]"
            >
              ביטול
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
