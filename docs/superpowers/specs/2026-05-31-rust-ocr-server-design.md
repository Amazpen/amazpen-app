# Rust OCR Server — Design Spec

**תאריך:** 2026-05-31
**סטטוס:** מאושר לתכנון מימוש
**הקשר:** שרת חיצוני עצמאי לחילוץ נתונים ממסמכים עסקיים ישראליים. נבנה כ-API עצמאי ברמה מקצועית גבוהה, ובהמשך ישולב במצפן (amazpen). **אינו נוגע בקוד הקיים** (`/api/ai/ocr`, n8n workflow `tUqWIHG1GfsJewLy`).

---

## 1. מטרה

שרת HTTP ב-Rust שמקבל מסמך (תמונה או PDF), מסווג את סוג המסמך, ומחזיר את כל הנתונים המובנים: ספק, ח.פ/עוסק, מספר ותאריך מסמך, סכום ביניים, מע"מ, סה"כ, שורות פריטים (תיאור/כמות/מחיר/הנחה), עם ציוני ביטחון פר-שדה.

מותאם לשוק הישראלי: עברית RTL, ח.פ/עוסק מורשה, מע"מ ישראלי, ₪/ש"ח, פורמטי תאריך ישראליים, מבני מסמכים ישראליים (חשבונית מס, תעודת משלוח, זיכוי, מרכזת, קבלה).

מנוע OCR: **Mistral** (`MISTRAL_API_KEY` קיים).

## 2. גישה ארכיטקטונית — "C" (שני-שלבים + ולידציה דטרמיניסטית)

1. **שלב 1 — Mistral OCR:** קובץ → Markdown נקי פר-עמוד (שומר טבלאות, חזק בעברית).
2. **שלב 2 — Structuring:** Markdown + prompt מותאם-ישראל + `json_schema` קשיח → מבנה מועמד עם סיווג סוג מסמך וציון ביטחון פר-שדה.
3. **שלב 3 — Validate (Rust דטרמיניסטי):** נרמול ואימות לא-תלוי-AI; משלים שדות חסרים אריתמטית; מסמן `warnings[]`; מעדכן ביטחון.

הנימוק: שכבת ולידציה דטרמיניסטית ב-Rust היא מה שמביא ל"רמה הכי גבוהה" ותופס שגיאות AI לפני שמגיעות למשתמש — בדיוק מה ש-Rust מצטיין בו.

## 3. סטאק

| תחום | בחירה |
|------|-------|
| HTTP | `axum` (על `tokio`) |
| HTTP client | `reqwest` |
| Serialization / schema | `serde`, `serde_json` |
| תמונות | `image` (+ `libheif-rs` ל-HEIC→JPEG) |
| לוגים | `tracing`, `tracing-subscriber` |
| שגיאות | `thiserror` |
| טסטים | built-in + `wiremock` (mock ל-Mistral) |

PDF עובר as-is ל-Mistral (תמיכה נייטיב במרובה-עמודים — אין צורך בהמרה לתמונות).

## 4. מבנה ה-crate

```
ocr-server/
  Cargo.toml
  .env.example
  Dockerfile
  src/
    main.rs            # bootstrap: config → router → serve
    config.rs          # env: MISTRAL_API_KEY, SERVER_API_KEY, PORT, model names, VAT_RATE
    error.rs           # AppError → תגובת HTTP (JSON {error:{code,message}})
    routes/
      mod.rs
      extract.rs       # POST /v1/extract  ← הליבה
      health.rs        # GET /health
    intake/
      mod.rs
      file.rs          # multipart, זיהוי content-type לפי magic bytes, מגבלת גודל
      image.rs         # אימות תמונה + HEIC→JPEG
    ocr/
      mod.rs
      mistral.rs       # שלב 1: קובץ → Markdown (Mistral OCR)
      structure.rs     # שלב 2: Markdown → JSON מובנה (LLM + json_schema)
      prompt.rs        # prompts מותאמי-ישראל + סיווג סוג מסמך
    model/
      mod.rs           # OCRExtractedData, LineItem, DocumentType, FieldConfidence
    validate/
      mod.rs
      tax_id.rs        # אימות ספרת ביקורת ח.פ/עוסק
      vat.rs           # אימות/השלמת מע"מ
      dates.rs         # נרמול תאריכים ל-ISO
      numbers.rs       # נרמול מספרים/מטבע
      line_items.rs    # סינון מק"ט-כתיאור, אימות סכומי שורות
  tests/
    fixtures/          # מסמכים ישראליים + פלט צפוי
    integration.rs
```

## 5. Endpoints

### `POST /v1/extract`
- **Auth:** `Authorization: Bearer <SERVER_API_KEY>`
- **Body:** `multipart/form-data` עם `file`
- **Query אופציונלי:**
  - `hint` — רמז לסוג מסמך (למשל `invoice`)
  - `bbox=true` — לכלול bounding boxes
  - `vat_rate` — override לשיעור מע"מ (ברירת מחדל מ-config)
- **תגובה (200):** ראה §6

### `GET /health`
- liveness/readiness. בודק שקיים `MISTRAL_API_KEY`. ללא auth.

## 6. חוזה פלט (תואם `OCRExtractedData` הקיים)

```jsonc
{
  "document_type": "invoice",          // invoice|delivery_note|credit_note|payment|summary|daily_entry
  "supplier_name": "string",
  "supplier_tax_id": "string",
  "document_number": "string",
  "document_date": "YYYY-MM-DD",
  "discount_amount": 0,
  "discount_percentage": 0,
  "subtotal": 0,
  "vat_amount": 0,
  "total_amount": 0,
  "line_items": [
    { "description": "string", "quantity": 0, "unit_price": 0,
      "discount_amount": 0, "discount_type": "amount|percent", "total": 0 }
  ],
  "confidence_score": 0.0,             // כללי
  "raw_text": "Markdown מ-Mistral",
  // הרחבות מעבר ל-OCRExtractedData הקיים:
  "field_confidence": { "supplier_name": 0.0, "total_amount": 0.0, "...": 0.0 },
  "warnings": [ { "code": "vat_mismatch", "message": "...", "field": "vat_amount" } ],
  "bbox": { /* אופציונלי כש-bbox=true */ }
}
```

השדות הליבתיים תואמים 1:1 ל-`src/types/ocr.ts` → שילוב עתידי במצפן הוא drop-in. ההרחבות (`field_confidence`, `warnings`, `bbox`) הן תוספת לא-שוברת.

## 7. כללי ולידציה ישראליים (שלב 3)

- **ח.פ/עוסק מורשה:** 9 ספרות + ספרת ביקורת (אלגוריתם ת.ז ישראלי). כשל → `warning`, לא חוסם.
- **מע"מ:** שיעור מ-config (כיום 18%) + override פר-בקשה + זיהוי מהמסמך. חסר אחד מ-{ביניים, מע"מ, סה"כ} → השלמה אריתמטית. סטייה > ₪0.01 → `warning` (לא מתקן בכוח).
- **תאריכים:** נרמול ל-ISO מ-`DD/MM/YYYY`, `DD.MM.YY`, חודשים בעברית. ברירת מחדל DD/MM (לא MM/DD).
- **מספרים/מטבע:** הסרת `₪`/`ש"ח`/מפרידי אלפים, טיפול בסימן RTL.
- **שורות פריטים:** סינון מק"ט/ברקוד שזוהה כתיאור; אימות `כמות × מחיר ≈ סה"כ שורה`.
- **זיכוי:** קונבנציית סימן אחידה לסכומים.

## 8. טיפול בשגיאות

`AppError` → JSON `{ "error": { "code", "message" } }`:

| code | HTTP | מתי |
|------|------|-----|
| `bad_request` | 400 | קובץ חסר/גדול מדי/סוג לא נתמך |
| `unauthorized` | 401 | token שגוי/חסר |
| `unprocessable` | 422 | OCR הצליח, חילוץ מבנה נכשל |
| `upstream_error` | 502 | Mistral נכשל |
| `upstream_timeout` | 504 | Mistral timeout |
| `internal` | 500 | אחר |

קריאות ל-Mistral: timeout + **retry מוגבל עם backoff** על 429/5xx. קודים מכניים באנגלית למיפוי קל במצפן.

## 9. אסטרטגיית טסטים (TDD)

- **Unit:** כל ולידטור פונקציה טהורה (`tax_id`, `vat`, `dates`, `numbers`, `line_items`) — טסטים קודם.
- **Integration:** שכבת HTTP עם Mistral ממוקֵ (`wiremock`): מסמך דוגמה → JSON צפוי.
- **Corpus regression:** fixtures של מסמכים ישראליים אמיתיים (חשבונית, ת.משלוח, זיכוי, מרכזת, קבלה) + פלט צפוי.

## 10. Deployment

- Dockerfile רב-שלבי: `rust:slim` (build) → runtime רזה (distroless/alpine), בינארי יחיד.
- רץ ב-Dokploy לצד שאר המערכת.
- Env: `MISTRAL_API_KEY`, `SERVER_API_KEY`, `PORT`, model names, `VAT_RATE`.
- `GET /health` ל-healthcheck של Dokploy.

## 11. מחוץ לסקופ (YAGNI)

- אין שינוי בקוד הקיים (`/api/ai/ocr`, n8n).
- אין שילוב במצפן בשלב זה — רק API עצמאי.
- אין OCR מקומי (לא Tesseract/ONNX) — מנוע נשאר Mistral.
- אין UI.

## 12. נקודות לאימות בתכנון המימוש

- הצורה המדויקת של Mistral OCR API (endpoint, document annotation / `json_schema`, פורמטי קלט נתמכים — האם HEIC נתמך ישירות) — לאמת מול תיעוד Mistral עדכני.
- האם להשתמש ב-document-annotation של Mistral OCR ישירות (קריאה אחת) או chat model נפרד לשלב 2 — להחליט לפי בדיקת איכות.
