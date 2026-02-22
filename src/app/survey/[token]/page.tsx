"use client";

import { useState, useEffect, use } from "react";

const LEAVE_REASONS = [
  { key: "price", label: "מחיר" },
  { key: "service", label: "איכות השירות" },
  { key: "no_need", label: "לא צריך יותר" },
  { key: "competitor", label: "עברתי למתחרה" },
  { key: "other", label: "אחר" },
];

export default function SurveyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [loading, setLoading] = useState(true);
  const [surveyData, setSurveyData] = useState<{ id: string; is_completed: boolean; business_name: string } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [serviceRating, setServiceRating] = useState(0);
  const [leaveReasons, setLeaveReasons] = useState<string[]>([]);
  const [npsScore, setNpsScore] = useState(0);
  const [freeText, setFreeText] = useState("");

  useEffect(() => {
    async function fetchSurvey() {
      try {
        const res = await fetch(`/api/surveys/${token}`);
        if (!res.ok) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        const data = await res.json();
        setSurveyData(data);
        if (data.is_completed) setSubmitted(true);
      } catch {
        setNotFound(true);
      }
      setLoading(false);
    }
    fetchSurvey();
  }, [token]);

  const handleSubmit = async () => {
    if (serviceRating === 0) return;
    setSubmitting(true);

    const responses = [
      { question_key: "service_rating", answer_value: String(serviceRating) },
      { question_key: "leave_reason", answer_value: leaveReasons.join(",") },
      { question_key: "nps_score", answer_value: String(npsScore) },
      { question_key: "free_text", answer_value: freeText },
    ];

    try {
      const res = await fetch(`/api/surveys/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responses }),
      });
      if (res.ok) setSubmitted(true);
    } catch {
      // ignore
    }
    setSubmitting(false);
  };

  const toggleReason = (key: string) => {
    setLeaveReasons((prev) =>
      prev.includes(key) ? prev.filter((r) => r !== key) : [...prev, key]
    );
  };

  if (loading) {
    return (
      <div dir="rtl" className="min-h-screen bg-[#0F1535] flex items-center justify-center">
        <div className="text-white/50 text-lg">טוען...</div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div dir="rtl" className="min-h-screen bg-[#0F1535] flex items-center justify-center">
        <div className="text-white/50 text-lg">הסקר לא נמצא</div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div dir="rtl" className="min-h-screen bg-[#0F1535] flex items-center justify-center px-4">
        <div className="bg-[#1a1f4e] rounded-2xl p-8 text-center max-w-md w-full">
          <div className="text-4xl mb-4">🙏</div>
          <h1 className="text-2xl font-bold text-white mb-2">תודה רבה!</h1>
          <p className="text-white/60">התשובות שלך נשמרו בהצלחה</p>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen bg-[#0F1535] flex items-center justify-center px-4 py-8">
      <div className="bg-[#1a1f4e] rounded-2xl p-6 max-w-lg w-full">
        <h1 className="text-xl font-bold text-white text-center mb-1">סקר שביעות רצון</h1>
        {surveyData?.business_name && (
          <p className="text-white/50 text-center text-sm mb-6">{surveyData.business_name}</p>
        )}

        {/* Q1: Service Rating (1-5 stars) */}
        <div className="mb-6">
          <label className="text-white text-sm font-medium mb-2 block">איך היה השירות?</label>
          <div className="flex gap-2 justify-center">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => setServiceRating(star)}
                className={`text-3xl transition-colors ${
                  star <= serviceRating ? "text-yellow-400" : "text-white/20"
                }`}
              >
                ★
              </button>
            ))}
          </div>
        </div>

        {/* Q2: Leave Reason (multi-select) */}
        <div className="mb-6">
          <label className="text-white text-sm font-medium mb-2 block">למה החלטת לא להמשיך?</label>
          <div className="flex flex-wrap gap-2">
            {LEAVE_REASONS.map((reason) => (
              <button
                key={reason.key}
                type="button"
                onClick={() => toggleReason(reason.key)}
                className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                  leaveReasons.includes(reason.key)
                    ? "bg-purple-600 text-white"
                    : "bg-white/10 text-white/60 hover:bg-white/20"
                }`}
              >
                {reason.label}
              </button>
            ))}
          </div>
        </div>

        {/* Q3: NPS (1-10) */}
        <div className="mb-6">
          <label className="text-white text-sm font-medium mb-2 block">
            האם תמליץ עלינו לחבר? (1-10)
          </label>
          <div className="flex gap-1 justify-center">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setNpsScore(n)}
                className={`w-8 h-8 rounded-lg text-sm font-bold transition-colors ${
                  n === npsScore
                    ? n <= 6
                      ? "bg-red-500 text-white"
                      : n <= 8
                        ? "bg-yellow-500 text-white"
                        : "bg-green-500 text-white"
                    : "bg-white/10 text-white/40 hover:bg-white/20"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Q4: Free Text */}
        <div className="mb-6">
          <label className="text-white text-sm font-medium mb-2 block">הערות נוספות</label>
          <textarea
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            placeholder="ספרו לנו עוד..."
            rows={3}
            className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-white text-sm placeholder:text-white/30 resize-none focus:outline-none focus:border-purple-500"
          />
        </div>

        {/* Submit */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || serviceRating === 0}
          className="w-full py-3 rounded-xl font-bold text-white transition-colors disabled:opacity-40 bg-purple-600 hover:bg-purple-700"
        >
          {submitting ? "שולח..." : "שלח"}
        </button>
      </div>
    </div>
  );
}
