"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { IncomeSource, SettlementType } from "@/types";

interface IncomeSourceSettlementEditorProps {
  source: IncomeSource;
  open: boolean;
  onClose: () => void;
  onSave: (updated: Partial<IncomeSource>) => void;
}

const settlementTypeLabels: Record<SettlementType, string> = {
  same_day: "באותו יום",
  daily: "יומי (עם עיכוב)",
  weekly: "שבועי",
  monthly: "חודשי",
  bimonthly: "דו-חודשי",
  custom: "מותאם (קופונים)",
};

const dayOfWeekLabels = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export function IncomeSourceSettlementEditor({ source, open, onClose, onSave }: IncomeSourceSettlementEditorProps) {
  const [settlementType, setSettlementType] = useState<SettlementType>(source.settlement_type || "daily");
  const [delayDays, setDelayDays] = useState(source.settlement_delay_days ?? 1);
  const [dayOfWeek, setDayOfWeek] = useState(source.settlement_day_of_week ?? 0);
  const [dayOfMonth, setDayOfMonth] = useState(source.settlement_day_of_month ?? 1);
  const [bimonthlyFirstCutoff, setBimonthlyFirstCutoff] = useState(source.bimonthly_first_cutoff ?? 14);
  const [bimonthlyFirstSettlement, setBimonthlyFirstSettlement] = useState(source.bimonthly_first_settlement ?? 2);
  const [bimonthlySecondSettlement, setBimonthlySecondSettlement] = useState(source.bimonthly_second_settlement ?? 8);
  const [commissionRate, setCommissionRate] = useState(source.commission_rate ?? 0);
  const [couponSettlementDate, setCouponSettlementDate] = useState(source.coupon_settlement_date ?? 1);
  const [couponRangeStart, setCouponRangeStart] = useState(source.coupon_range_start ?? 1);
  const [couponRangeEnd, setCouponRangeEnd] = useState(source.coupon_range_end ?? 31);

  const handleSave = () => {
    onSave({
      settlement_type: settlementType,
      settlement_delay_days: delayDays,
      settlement_day_of_week: settlementType === "weekly" ? dayOfWeek : undefined,
      settlement_day_of_month: settlementType === "monthly" ? dayOfMonth : undefined,
      bimonthly_first_cutoff: settlementType === "bimonthly" ? bimonthlyFirstCutoff : undefined,
      bimonthly_first_settlement: settlementType === "bimonthly" ? bimonthlyFirstSettlement : undefined,
      bimonthly_second_settlement: settlementType === "bimonthly" ? bimonthlySecondSettlement : undefined,
      commission_rate: commissionRate,
      coupon_settlement_date: settlementType === "custom" ? couponSettlementDate : undefined,
      coupon_range_start: settlementType === "custom" ? couponRangeStart : undefined,
      coupon_range_end: settlementType === "custom" ? couponRangeEnd : undefined,
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-[#0F1535] border-white/10 text-white max-w-[420px]" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right text-[18px]">
            הגדרות תקבול — {source.name}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-[14px] mt-[10px]">
          {/* Settlement Type */}
          <div className="flex flex-col gap-[6px]">
            <label className="text-[13px] text-white/60 text-right">סוג תקבול</label>
            <Select value={settlementType} onValueChange={(v) => setSettlementType(v as SettlementType)}>
              <SelectTrigger className="bg-[#232B6A] border-white/10 text-white text-right h-[40px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#232B6A] border-white/10">
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
                className="bg-[#232B6A] border-white/10 text-white text-center h-[40px]"
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
                <SelectTrigger className="bg-[#232B6A] border-white/10 text-white text-right h-[40px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#232B6A] border-white/10">
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
                className="bg-[#232B6A] border-white/10 text-white text-center h-[40px]"
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
                  className="bg-[#232B6A] border-white/10 text-white text-center h-[40px]"
                />
                <p className="text-[11px] text-white/40 text-right">
                  הכנסות מ-1 עד {bimonthlyFirstCutoff} לחודש → נכנסות ב-{bimonthlyFirstSettlement} לחודש הבא
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
                    className="bg-[#232B6A] border-white/10 text-white text-center h-[40px]"
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
                    className="bg-[#232B6A] border-white/10 text-white text-center h-[40px]"
                  />
                </div>
              </div>
              <p className="text-[11px] text-white/40 text-right">
                הכנסות מ-{bimonthlyFirstCutoff + 1} עד סוף החודש → נכנסות ב-{bimonthlySecondSettlement} לחודש הבא
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
                  className="bg-[#232B6A] border-white/10 text-white text-center h-[40px]"
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
                    className="bg-[#232B6A] border-white/10 text-white text-center h-[40px]"
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
                    className="bg-[#232B6A] border-white/10 text-white text-center h-[40px]"
                  />
                </div>
              </div>
              <p className="text-[11px] text-white/40 text-right">
                כל הקופונים שנרשמו מ-{couponRangeStart} עד {couponRangeEnd} → נכנסים ב-{couponSettlementDate} לחודש הבא
              </p>
            </>
          )}

          {/* Commission Rate — shown for all types */}
          <div className="flex flex-col gap-[6px]">
            <label className="text-[13px] text-white/60 text-right">עמלת סליקה (%)</label>
            <Input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={commissionRate}
              onChange={(e) => setCommissionRate(parseFloat(e.target.value) || 0)}
              className="bg-[#232B6A] border-white/10 text-white text-center h-[40px]"
            />
            {commissionRate > 0 && (
              <p className="text-[11px] text-white/40 text-right">
                ירד {commissionRate}% מכל הכנסה מ{source.name}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-[10px] mt-[6px]">
            <Button
              onClick={handleSave}
              className="flex-1 bg-[#4956D4] text-white text-[14px] font-semibold py-[10px] rounded-[8px]"
            >
              שמור
            </Button>
            <Button
              variant="ghost"
              onClick={onClose}
              className="flex-1 text-white/60 text-[14px] py-[10px] rounded-[8px]"
            >
              ביטול
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
