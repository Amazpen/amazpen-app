"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PaymentMethodType, SettlementType } from "@/types";

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
};

const dayOfWeekLabels = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

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
      <DialogContent className="bg-[#0F1535] border-[#2A3178]/60 text-white max-w-[420px] p-0 overflow-hidden" dir="rtl">
        {/* Header with accent gradient */}
        <div className="bg-gradient-to-l from-[#4956D4]/20 to-transparent px-[20px] pt-[20px] pb-[14px] border-b border-white/5">
          <DialogHeader>
            <DialogTitle className="text-right text-[17px] font-bold text-white flex items-center gap-[8px]">
              <span className="w-[8px] h-[8px] rounded-full bg-[#4956D4] inline-block shrink-0" />
              {method.name}
            </DialogTitle>
            <DialogDescription className="text-[12px] text-white/40 text-right mt-[4px]">
              הגדר מתי הכסף מ{method.name} נכנס לחשבון הבנק
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex flex-col gap-[16px] px-[20px] py-[16px]">
          {/* Settlement Type */}
          <div className="flex flex-col gap-[6px]">
            <label className="text-[12px] font-medium text-white/50 text-right">סוג התחשבנות</label>
            <Select value={settlementType} onValueChange={(v) => setSettlementType(v as SettlementType)}>
              <SelectTrigger className="w-full bg-[#1A2155] border-[#2A3178] text-white text-right h-[42px] rounded-[10px] hover:border-[#4956D4]/50 transition-colors">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#1A2155] border-[#2A3178]">
                {(Object.entries(settlementTypeLabels) as [SettlementType, string][]).map(([value, label]) => (
                  <SelectItem key={value} value={value} className="text-white text-right hover:bg-[#4956D4]/20 focus:bg-[#4956D4]/20 focus:text-white">
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Daily: delay days */}
          {(settlementType === "daily" || settlementType === "same_day") && (
            <div className="bg-[#1A2155]/50 rounded-[12px] p-[14px] border border-[#2A3178]/40">
              <label className="text-[12px] font-medium text-white/50 text-right block mb-[8px]">עיכוב בימים</label>
              <Input
                type="number"
                min={0}
                max={30}
                value={settlementType === "same_day" ? 0 : delayDays}
                onChange={(e) => setDelayDays(parseInt(e.target.value) || 0)}
                disabled={settlementType === "same_day"}
                className="bg-[#0F1535] border-[#2A3178] text-white text-center h-[42px] rounded-[10px] text-[16px] font-semibold"
              />
              <p className="text-[11px] text-[#4956D4]/80 text-right mt-[6px]">
                {settlementType === "same_day" ? "נכנס באותו יום" : `נכנס ${delayDays} ימים אחרי הרישום`}
              </p>
            </div>
          )}

          {/* Weekly: day of week */}
          {settlementType === "weekly" && (
            <div className="bg-[#1A2155]/50 rounded-[12px] p-[14px] border border-[#2A3178]/40">
              <label className="text-[12px] font-medium text-white/50 text-right block mb-[8px]">יום תקבול בשבוע</label>
              <Select value={String(dayOfWeek)} onValueChange={(v) => setDayOfWeek(parseInt(v))}>
                <SelectTrigger className="w-full bg-[#0F1535] border-[#2A3178] text-white text-right h-[42px] rounded-[10px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#1A2155] border-[#2A3178]">
                  {dayOfWeekLabels.map((label, i) => (
                    <SelectItem key={i} value={String(i)} className="text-white text-right hover:bg-[#4956D4]/20 focus:bg-[#4956D4]/20 focus:text-white">
                      יום {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Monthly: day of month */}
          {settlementType === "monthly" && (
            <div className="bg-[#1A2155]/50 rounded-[12px] p-[14px] border border-[#2A3178]/40">
              <label className="text-[12px] font-medium text-white/50 text-right block mb-[8px]">יום תקבול בחודש</label>
              <Input
                type="number"
                min={1}
                max={31}
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(parseInt(e.target.value) || 1)}
                className="bg-[#0F1535] border-[#2A3178] text-white text-center h-[42px] rounded-[10px] text-[16px] font-semibold"
              />
            </div>
          )}

          {/* Bimonthly: cutoff + 2 settlement days */}
          {settlementType === "bimonthly" && (
            <div className="bg-[#1A2155]/50 rounded-[12px] p-[14px] border border-[#2A3178]/40 flex flex-col gap-[12px]">
              <div className="flex flex-col gap-[6px]">
                <label className="text-[12px] font-medium text-white/50 text-right">תאריך חיתוך (תקופה ראשונה עד יום)</label>
                <Input
                  type="number"
                  min={1}
                  max={28}
                  value={bimonthlyFirstCutoff}
                  onChange={(e) => setBimonthlyFirstCutoff(parseInt(e.target.value) || 14)}
                  className="bg-[#0F1535] border-[#2A3178] text-white text-center h-[42px] rounded-[10px] text-[16px] font-semibold"
                />
                <p className="text-[11px] text-[#4956D4]/80 text-right">
                  הכנסות מ-1 עד {bimonthlyFirstCutoff} לחודש &larr; נכנסות ב-{bimonthlyFirstSettlement} לחודש הבא
                </p>
              </div>
              <div className="flex gap-[10px]">
                <div className="flex-1 flex flex-col gap-[6px]">
                  <label className="text-[12px] font-medium text-white/50 text-right">יום תשלום 1</label>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={bimonthlyFirstSettlement}
                    onChange={(e) => setBimonthlyFirstSettlement(parseInt(e.target.value) || 2)}
                    className="bg-[#0F1535] border-[#2A3178] text-white text-center h-[42px] rounded-[10px] text-[16px] font-semibold"
                  />
                </div>
                <div className="flex-1 flex flex-col gap-[6px]">
                  <label className="text-[12px] font-medium text-white/50 text-right">יום תשלום 2</label>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={bimonthlySecondSettlement}
                    onChange={(e) => setBimonthlySecondSettlement(parseInt(e.target.value) || 8)}
                    className="bg-[#0F1535] border-[#2A3178] text-white text-center h-[42px] rounded-[10px] text-[16px] font-semibold"
                  />
                </div>
              </div>
              <p className="text-[11px] text-[#4956D4]/80 text-right">
                הכנסות מ-{bimonthlyFirstCutoff + 1} עד סוף החודש &larr; נכנסות ב-{bimonthlySecondSettlement} לחודש הבא
              </p>
            </div>
          )}

          {/* Custom (Coupons): settlement date + range */}
          {settlementType === "custom" && (
            <div className="bg-[#1A2155]/50 rounded-[12px] p-[14px] border border-[#2A3178]/40 flex flex-col gap-[12px]">
              <div className="flex flex-col gap-[6px]">
                <label className="text-[12px] font-medium text-white/50 text-right">יום כניסת הקופונים בחודש</label>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={couponSettlementDate}
                  onChange={(e) => setCouponSettlementDate(parseInt(e.target.value) || 1)}
                  className="bg-[#0F1535] border-[#2A3178] text-white text-center h-[42px] rounded-[10px] text-[16px] font-semibold"
                />
              </div>
              <div className="flex gap-[10px]">
                <div className="flex-1 flex flex-col gap-[6px]">
                  <label className="text-[12px] font-medium text-white/50 text-right">מיום</label>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={couponRangeStart}
                    onChange={(e) => setCouponRangeStart(parseInt(e.target.value) || 1)}
                    className="bg-[#0F1535] border-[#2A3178] text-white text-center h-[42px] rounded-[10px] text-[16px] font-semibold"
                  />
                </div>
                <div className="flex-1 flex flex-col gap-[6px]">
                  <label className="text-[12px] font-medium text-white/50 text-right">עד יום</label>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={couponRangeEnd}
                    onChange={(e) => setCouponRangeEnd(parseInt(e.target.value) || 31)}
                    className="bg-[#0F1535] border-[#2A3178] text-white text-center h-[42px] rounded-[10px] text-[16px] font-semibold"
                  />
                </div>
              </div>
              <p className="text-[11px] text-[#4956D4]/80 text-right">
                כל הקופונים שנרשמו מ-{couponRangeStart} עד {couponRangeEnd} &larr; נכנסים ב-{couponSettlementDate} לחודש הבא
              </p>
            </div>
          )}

          {/* Commission Rate — shown for all types */}
          <div className="flex flex-col gap-[6px]">
            <label className="text-[12px] font-medium text-white/50 text-right">עמלת סליקה (%)</label>
            <Input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={commissionRate}
              onChange={(e) => setCommissionRate(parseFloat(e.target.value) || 0)}
              className="bg-[#1A2155] border-[#2A3178] text-white text-center h-[42px] rounded-[10px]"
            />
            {commissionRate > 0 && (
              <p className="text-[11px] text-[#FA5A7D]/70 text-right">
                ירד {commissionRate}% מכל הכנסה מ{method.name}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-[10px] pt-[4px]">
            <Button
              onClick={handleSave}
              className="flex-1 bg-[#4956D4] hover:bg-[#5A67E0] text-white text-[14px] font-semibold py-[11px] rounded-[10px] transition-colors"
            >
              שמור
            </Button>
            <Button
              variant="ghost"
              onClick={onClose}
              className="flex-1 text-white/50 hover:text-white/80 hover:bg-white/5 text-[14px] py-[11px] rounded-[10px] transition-colors"
            >
              ביטול
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
