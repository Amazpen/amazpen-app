# Rust OCR Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Rust HTTP server that accepts an image or PDF of an Israeli business document, runs Mistral OCR, classifies the document, and returns fully-structured, validated JSON (supplier, tax id, dates, totals, VAT, line items) with per-field confidence.

**Architecture:** Two-stage extraction + deterministic validation. Stage 1 = Mistral OCR (file → markdown). Stage 2 = Mistral chat with a strict JSON schema (markdown → structured candidate + document classification). Stage 3 = pure-Rust validators that normalize and reconcile fields (Israeli tax-id checksum, VAT math, date/number normalization, line-item sanity) and attach warnings.

**Tech Stack:** Rust, `axum`, `tokio`, `reqwest`, `serde`/`serde_json`, `image` (+ `libheif-rs`), `tracing`, `thiserror`, `wiremock` (tests).

**IMPORTANT — project location:** This is a **standalone project**, NOT inside amazpen. All code paths below are under `C:\Users\netn1\Downloads\ocr-server\`. It gets its own git repository. This plan doc lives in the amazpen repo only as a planning artifact.

**API note:** The Mistral request/response shapes used below reflect the documented Mistral OCR + chat APIs (`POST /v1/ocr` with `mistral-ocr-latest`; `POST /v1/chat/completions` with `response_format: json_schema`). Task 0 includes a step to verify these against current docs before relying on them; if a field name differs, adjust the structs in `ocr/mistral.rs` / `ocr/structure.rs` only.

---

## File Structure

```
ocr-server/
  Cargo.toml              # deps + metadata
  .env.example            # documented env vars (no secrets)
  .gitignore
  Dockerfile              # multi-stage build
  src/
    main.rs               # bootstrap: load config, build router, serve
    config.rs             # Config struct from env
    error.rs              # AppError + axum IntoResponse
    state.rs              # AppState (config + reqwest client)
    routes/
      mod.rs
      health.rs           # GET /health
      extract.rs          # POST /v1/extract (orchestrates intake→ocr→structure→validate)
    middleware/
      mod.rs
      auth.rs             # Bearer token guard
    intake/
      mod.rs
      file.rs             # multipart read, magic-byte sniff, size limit, Kind enum
      image.rs            # HEIC→JPEG conversion
    ocr/
      mod.rs
      mistral.rs          # stage 1: bytes → markdown
      structure.rs        # stage 2: markdown → StructuredCandidate
      prompt.rs           # Israel-tuned system prompt + JSON schema
    model/
      mod.rs              # ExtractedData, LineItem, DocumentType, Warning, FieldConfidence
    validate/
      mod.rs              # validate(candidate) -> ExtractedData + warnings
      numbers.rs          # parse_amount
      dates.rs            # normalize_date
      tax_id.rs           # is_valid_israeli_id
      vat.rs              # reconcile_vat
      line_items.rs       # clean_line_items
  tests/
    integration.rs        # full POST /v1/extract with Mistral mocked (wiremock)
    fixtures/
      invoice_markdown.txt
```

---

## Task 0: Scaffold the standalone project

**Files:**
- Create: `C:\Users\netn1\Downloads\ocr-server\Cargo.toml`
- Create: `C:\Users\netn1\Downloads\ocr-server\.gitignore`
- Create: `C:\Users\netn1\Downloads\ocr-server\.env.example`
- Create: `C:\Users\netn1\Downloads\ocr-server\src\main.rs`

- [ ] **Step 1: Verify Mistral API shapes** — Before writing client code, fetch current Mistral docs for the OCR endpoint (`/v1/ocr`, model `mistral-ocr-latest`, image/document input, `pages[].markdown` response) and chat structured outputs (`response_format: {type:"json_schema"}`). Note any field-name differences to apply in Tasks 8–9. Use Context7 (`resolve-library-id` → `query-docs` for "mistral ai") or WebFetch `https://docs.mistral.ai/`.

- [ ] **Step 2: Create the project directory and git repo**

Run:
```powershell
New-Item -ItemType Directory -Force "C:\Users\netn1\Downloads\ocr-server\src"
cd "C:\Users\netn1\Downloads\ocr-server"; git init
```

- [ ] **Step 3: Write `Cargo.toml`**

```toml
[package]
name = "ocr-server"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = { version = "0.7", features = ["multipart"] }
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "1"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
base64 = "0.22"
image = "0.25"
libheif-rs = "1"

[dev-dependencies]
wiremock = "0.6"
```

- [ ] **Step 4: Write `.gitignore`**

```
/target
.env
```

- [ ] **Step 5: Write `.env.example`**

```
# Mistral API key (OCR + structuring). Required.
MISTRAL_API_KEY=
# Bearer token clients must send in Authorization header. Required.
SERVER_API_KEY=
# Port to listen on. Default 8080.
PORT=8080
# Mistral models.
MISTRAL_OCR_MODEL=mistral-ocr-latest
MISTRAL_CHAT_MODEL=mistral-large-latest
# Default Israeli VAT rate (percent).
VAT_RATE=18
# Max upload size in bytes. Default 20MB.
MAX_UPLOAD_BYTES=20971520
```

- [ ] **Step 6: Write a placeholder `src/main.rs` so the crate compiles**

```rust
fn main() {
    println!("ocr-server");
}
```

- [ ] **Step 7: Verify it builds**

Run: `cargo build`
Expected: compiles (downloads deps). If `libheif-rs` fails to build on Windows for lack of system libheif, defer it — comment out `libheif-rs` in Cargo.toml and the `image.rs` HEIC path (Task 7) until a build environment with libheif is available; everything else is unaffected.

- [ ] **Step 8: Commit**

```powershell
git add -A; git commit -m "chore: scaffold ocr-server crate"
```

---

## Task 1: Config from environment

**Files:**
- Create: `C:\Users\netn1\Downloads\ocr-server\src\config.rs`
- Modify: `src\main.rs`

- [ ] **Step 1: Write the failing test** (append to `src/config.rs`)

```rust
#[derive(Clone, Debug)]
pub struct Config {
    pub mistral_api_key: String,
    pub server_api_key: String,
    pub port: u16,
    pub ocr_model: String,
    pub chat_model: String,
    pub vat_rate: f64,
    pub max_upload_bytes: usize,
}

impl Config {
    /// Build from a key→value lookup. Pure, so it is testable without touching real env.
    pub fn from_map(get: impl Fn(&str) -> Option<String>) -> Result<Self, String> {
        let req = |k: &str| get(k).filter(|v| !v.is_empty()).ok_or_else(|| format!("missing env {k}"));
        Ok(Config {
            mistral_api_key: req("MISTRAL_API_KEY")?,
            server_api_key: req("SERVER_API_KEY")?,
            port: get("PORT").and_then(|v| v.parse().ok()).unwrap_or(8080),
            ocr_model: get("MISTRAL_OCR_MODEL").unwrap_or_else(|| "mistral-ocr-latest".into()),
            chat_model: get("MISTRAL_CHAT_MODEL").unwrap_or_else(|| "mistral-large-latest".into()),
            vat_rate: get("VAT_RATE").and_then(|v| v.parse().ok()).unwrap_or(18.0),
            max_upload_bytes: get("MAX_UPLOAD_BYTES").and_then(|v| v.parse().ok()).unwrap_or(20 * 1024 * 1024),
        })
    }

    /// Read from process environment.
    pub fn from_env() -> Result<Self, String> {
        Self::from_map(|k| std::env::var(k).ok())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn map(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let m: HashMap<String, String> = pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        move |k: &str| m.get(k).cloned()
    }

    #[test]
    fn applies_defaults_when_optional_missing() {
        let cfg = Config::from_map(map(&[("MISTRAL_API_KEY", "m"), ("SERVER_API_KEY", "s")])).unwrap();
        assert_eq!(cfg.port, 8080);
        assert_eq!(cfg.vat_rate, 18.0);
        assert_eq!(cfg.ocr_model, "mistral-ocr-latest");
    }

    #[test]
    fn errors_when_required_missing() {
        let err = Config::from_map(map(&[("SERVER_API_KEY", "s")])).unwrap_err();
        assert!(err.contains("MISTRAL_API_KEY"));
    }

    #[test]
    fn parses_overrides() {
        let cfg = Config::from_map(map(&[
            ("MISTRAL_API_KEY", "m"), ("SERVER_API_KEY", "s"), ("PORT", "9000"), ("VAT_RATE", "17"),
        ])).unwrap();
        assert_eq!(cfg.port, 9000);
        assert_eq!(cfg.vat_rate, 17.0);
    }
}
```

- [ ] **Step 2: Declare the module** — add to top of `src/main.rs`: `mod config;`

- [ ] **Step 3: Run tests to verify they pass**

Run: `cargo test config::`
Expected: 3 passed.

- [ ] **Step 4: Commit**

```powershell
git add -A; git commit -m "feat(config): env-driven Config with defaults"
```

---

## Task 2: Domain model

**Files:**
- Create: `C:\Users\netn1\Downloads\ocr-server\src\model\mod.rs`
- Modify: `src\main.rs`

- [ ] **Step 1: Write the model** (`src/model/mod.rs`)

```rust
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DocumentType {
    Invoice,
    DeliveryNote,
    CreditNote,
    Payment,
    Summary,
    DailyEntry,
    Unknown,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct LineItem {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quantity: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit_price: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub discount_amount: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Warning {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
}

/// Output contract. Core fields mirror amazpen's `OCRExtractedData` (src/types/ocr.ts).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ExtractedData {
    pub document_type: Option<DocumentType>,
    pub supplier_name: Option<String>,
    pub supplier_tax_id: Option<String>,
    pub document_number: Option<String>,
    pub document_date: Option<String>,
    pub discount_amount: Option<f64>,
    pub discount_percentage: Option<f64>,
    pub subtotal: Option<f64>,
    pub vat_amount: Option<f64>,
    pub total_amount: Option<f64>,
    #[serde(default)]
    pub line_items: Vec<LineItem>,
    pub confidence_score: Option<f64>,
    pub raw_text: Option<String>,
    // Extensions beyond the existing TS type (non-breaking):
    #[serde(default)]
    pub warnings: Vec<Warning>,
}

impl ExtractedData {
    pub fn warn(&mut self, code: &str, message: &str, field: Option<&str>) {
        self.warnings.push(Warning {
            code: code.into(),
            message: message.into(),
            field: field.map(|f| f.into()),
        });
    }
}
```

- [ ] **Step 2: Declare module** — add `mod model;` to `src/main.rs`.

- [ ] **Step 3: Verify it compiles**

Run: `cargo build`
Expected: compiles.

- [ ] **Step 4: Commit**

```powershell
git add -A; git commit -m "feat(model): ExtractedData output contract"
```

---

## Task 3: Number/currency normalization

**Files:**
- Create: `C:\Users\netn1\Downloads\ocr-server\src\validate\numbers.rs`
- Create: `C:\Users\netn1\Downloads\ocr-server\src\validate\mod.rs`
- Modify: `src\main.rs`

- [ ] **Step 1: Write the failing test** (`src/validate/numbers.rs`)

```rust
/// Parse a money/number string that may carry ₪, ש"ח, thousands separators,
/// RTL marks, or surrounding whitespace. Returns None if no number is present.
pub fn parse_amount(raw: &str) -> Option<f64> {
    // Strip RTL/LRM marks and currency tokens.
    let cleaned: String = raw
        .replace('\u{200f}', "")
        .replace('\u{200e}', "")
        .replace('\u{202b}', "")
        .replace('\u{202c}', "")
        .replace('₪', "")
        .replace("ש\"ח", "")
        .replace("שח", "");
    // Keep digits, sign, separators.
    let mut s: String = cleaned
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.' || *c == ',' || *c == '-')
        .collect();
    if s.is_empty() {
        return None;
    }
    // Israeli convention: comma = thousands separator, dot = decimal.
    s = s.replace(',', "");
    s.parse::<f64>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain() {
        assert_eq!(parse_amount("1234.5"), Some(1234.5));
    }

    #[test]
    fn strips_currency_and_thousands() {
        assert_eq!(parse_amount("₪1,234.50"), Some(1234.50));
        assert_eq!(parse_amount("1,234.50 ש\"ח"), Some(1234.50));
    }

    #[test]
    fn handles_negative_and_rtl_marks() {
        assert_eq!(parse_amount("\u{200f}-58.00"), Some(-58.0));
    }

    #[test]
    fn returns_none_for_no_digits() {
        assert_eq!(parse_amount("סה\"כ"), None);
    }
}
```

- [ ] **Step 2: Create `src/validate/mod.rs`**

```rust
pub mod numbers;
```

- [ ] **Step 3: Declare module** — add `mod validate;` to `src/main.rs`.

- [ ] **Step 4: Run tests**

Run: `cargo test validate::numbers::`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```powershell
git add -A; git commit -m "feat(validate): parse_amount currency/number normalization"
```

---

## Task 4: Date normalization to ISO

**Files:**
- Create: `C:\Users\netn1\Downloads\ocr-server\src\validate\dates.rs`
- Modify: `src\validate\mod.rs`

- [ ] **Step 1: Write the failing test** (`src/validate/dates.rs`)

```rust
/// Normalize a date string to ISO `YYYY-MM-DD`. Assumes Israeli day-first order
/// for ambiguous numeric dates. Returns None if it cannot parse.
pub fn normalize_date(raw: &str) -> Option<String> {
    let t = raw.trim();
    // Already ISO?
    if let Some((y, m, d)) = split3(t, '-') {
        if y > 1900 {
            return iso(y, m, d);
        }
    }
    // DD/MM/YYYY or DD.MM.YYYY or DD/MM/YY
    for sep in ['/', '.', '-'] {
        if let Some((d, m, y)) = split3(t, sep) {
            let year = if y < 100 { 2000 + y } else { y };
            return iso(year, m, d);
        }
    }
    None
}

fn split3(s: &str, sep: char) -> Option<(i32, i32, i32)> {
    let parts: Vec<&str> = s.split(sep).collect();
    if parts.len() != 3 {
        return None;
    }
    let a = parts[0].trim().parse().ok()?;
    let b = parts[1].trim().parse().ok()?;
    let c = parts[2].trim().parse().ok()?;
    Some((a, b, c))
}

fn iso(y: i32, m: i32, d: i32) -> Option<String> {
    if (1..=12).contains(&m) && (1..=31).contains(&d) {
        Some(format!("{y:04}-{m:02}-{d:02}"))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_slash_day_first() {
        assert_eq!(normalize_date("31/05/2026"), Some("2026-05-31".into()));
    }

    #[test]
    fn parses_dot_two_digit_year() {
        assert_eq!(normalize_date("31.05.26"), Some("2026-05-31".into()));
    }

    #[test]
    fn passes_through_iso() {
        assert_eq!(normalize_date("2026-05-31"), Some("2026-05-31".into()));
    }

    #[test]
    fn rejects_garbage() {
        assert_eq!(normalize_date("not a date"), None);
    }
}
```

- [ ] **Step 2: Register module** — add `pub mod dates;` to `src/validate/mod.rs`.

- [ ] **Step 3: Run tests**

Run: `cargo test validate::dates::`
Expected: 4 passed.

- [ ] **Step 4: Commit**

```powershell
git add -A; git commit -m "feat(validate): normalize_date to ISO (day-first)"
```

---

## Task 5: Israeli tax-id checksum

**Files:**
- Create: `C:\Users\netn1\Downloads\ocr-server\src\validate\tax_id.rs`
- Modify: `src\validate\mod.rs`

- [ ] **Step 1: Write the failing test** (`src/validate/tax_id.rs`)

```rust
/// Validate a 9-digit Israeli ID / company number (ח.פ / עוסק) check digit.
/// Same check-digit algorithm as ת"ז. Non-digits are ignored; the number is
/// left-padded to 9 digits.
pub fn is_valid_israeli_id(raw: &str) -> bool {
    let digits: Vec<u32> = raw.chars().filter_map(|c| c.to_digit(10)).collect();
    if digits.is_empty() || digits.len() > 9 {
        return false;
    }
    // Left-pad to 9.
    let mut padded = vec![0u32; 9 - digits.len()];
    padded.extend(digits);
    let mut sum = 0u32;
    for (i, d) in padded.iter().enumerate() {
        let mut v = d * if i % 2 == 0 { 1 } else { 2 };
        if v > 9 {
            v -= 9;
        }
        sum += v;
    }
    sum % 10 == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_valid() {
        // 123456782 has a correct check digit.
        assert!(is_valid_israeli_id("123456782"));
    }

    #[test]
    fn rejects_invalid_check_digit() {
        assert!(!is_valid_israeli_id("123456789"));
    }

    #[test]
    fn ignores_non_digits() {
        assert!(is_valid_israeli_id("12-345-6782"));
    }

    #[test]
    fn rejects_too_long() {
        assert!(!is_valid_israeli_id("1234567820"));
    }
}
```

- [ ] **Step 2: Register module** — add `pub mod tax_id;` to `src/validate/mod.rs`.

- [ ] **Step 3: Run tests**

Run: `cargo test validate::tax_id::`
Expected: 4 passed.

- [ ] **Step 4: Commit**

```powershell
git add -A; git commit -m "feat(validate): Israeli tax-id checksum"
```

---

## Task 6: VAT reconciliation

**Files:**
- Create: `C:\Users\netn1\Downloads\ocr-server\src\validate\vat.rs`
- Modify: `src\validate\mod.rs`

- [ ] **Step 1: Write the failing test** (`src/validate/vat.rs`)

```rust
/// Result of reconciling the {subtotal, vat, total} triple at a given VAT rate.
#[derive(Debug, Clone, PartialEq)]
pub struct VatResult {
    pub subtotal: Option<f64>,
    pub vat_amount: Option<f64>,
    pub total_amount: Option<f64>,
    /// True when all three were present and mutually consistent within tolerance,
    /// OR a missing field was filled from the other two.
    pub consistent: bool,
}

const TOL: f64 = 0.01;

/// Fill a missing member of {subtotal, vat, total} and check consistency.
/// `rate` is a percentage (e.g. 18.0).
pub fn reconcile_vat(
    subtotal: Option<f64>,
    vat: Option<f64>,
    total: Option<f64>,
    rate: f64,
) -> VatResult {
    let r = rate / 100.0;
    let (mut s, mut v, mut t) = (subtotal, vat, total);

    match (s, v, t) {
        (Some(s0), _, Some(t0)) if v.is_none() => v = Some(round2(t0 - s0)),
        (Some(s0), Some(v0), None) => t = Some(round2(s0 + v0)),
        (None, Some(v0), Some(t0)) => s = Some(round2(t0 - v0)),
        (Some(s0), None, None) => {
            v = Some(round2(s0 * r));
            t = Some(round2(s0 * (1.0 + r)));
        }
        (None, None, Some(t0)) => {
            s = Some(round2(t0 / (1.0 + r)));
            v = Some(round2(t0 - t0 / (1.0 + r)));
        }
        _ => {}
    }

    let consistent = match (s, v, t) {
        (Some(s0), Some(v0), Some(t0)) => (s0 + v0 - t0).abs() <= TOL,
        _ => false,
    };

    VatResult { subtotal: s, vat_amount: v, total_amount: t, consistent }
}

fn round2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fills_total_from_subtotal_and_vat() {
        let r = reconcile_vat(Some(100.0), Some(18.0), None, 18.0);
        assert_eq!(r.total_amount, Some(118.0));
        assert!(r.consistent);
    }

    #[test]
    fn fills_subtotal_and_vat_from_total() {
        let r = reconcile_vat(None, None, Some(118.0), 18.0);
        assert_eq!(r.subtotal, Some(100.0));
        assert_eq!(r.vat_amount, Some(18.0));
        assert!(r.consistent);
    }

    #[test]
    fn flags_inconsistent_triple() {
        let r = reconcile_vat(Some(100.0), Some(18.0), Some(150.0), 18.0);
        assert!(!r.consistent);
    }

    #[test]
    fn computes_from_subtotal_only() {
        let r = reconcile_vat(Some(200.0), None, None, 18.0);
        assert_eq!(r.vat_amount, Some(36.0));
        assert_eq!(r.total_amount, Some(236.0));
    }
}
```

- [ ] **Step 2: Register module** — add `pub mod vat;` to `src/validate/mod.rs`.

- [ ] **Step 3: Run tests**

Run: `cargo test validate::vat::`
Expected: 4 passed.

- [ ] **Step 4: Commit**

```powershell
git add -A; git commit -m "feat(validate): VAT reconciliation + back-fill"
```

---

## Task 7: Line-item cleanup

**Files:**
- Create: `C:\Users\netn1\Downloads\ocr-server\src\validate\line_items.rs`
- Modify: `src\validate\mod.rs`

- [ ] **Step 1: Write the failing test** (`src/validate/line_items.rs`)

```rust
use crate::model::LineItem;

/// True when a description is really a SKU/barcode (digits-only or a short
/// alphanumeric code), not a human description.
pub fn looks_like_code(desc: &str) -> bool {
    let t = desc.trim();
    if t.is_empty() {
        return false;
    }
    let digits = t.chars().filter(|c| c.is_ascii_digit()).count();
    let letters = t.chars().filter(|c| c.is_alphabetic()).count();
    // Pure number, or mostly digits with no real word.
    (letters == 0 && digits >= 3) || (digits >= 5 && letters <= 1)
}

/// Drop SKU-as-description text and, when quantity*unit_price disagrees with the
/// stated line total beyond tolerance, leave the values but the caller may warn.
pub fn clean_line_items(items: Vec<LineItem>) -> Vec<LineItem> {
    items
        .into_iter()
        .map(|mut it| {
            if let Some(d) = &it.description {
                if looks_like_code(d) {
                    it.description = None;
                }
            }
            it
        })
        .collect()
}

/// True when quantity*unit_price matches total within 1 agora.
pub fn line_total_consistent(it: &LineItem) -> bool {
    match (it.quantity, it.unit_price, it.total) {
        (Some(q), Some(p), Some(t)) => (q * p - t).abs() <= 0.01,
        _ => true, // not enough info to judge
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_pure_number_code() {
        assert!(looks_like_code("7290001234567"));
    }

    #[test]
    fn keeps_real_description() {
        assert!(!looks_like_code("עגבניות שרי"));
    }

    #[test]
    fn strips_code_description() {
        let items = vec![LineItem { description: Some("123456".into()), ..Default::default() }];
        assert_eq!(clean_line_items(items)[0].description, None);
    }

    #[test]
    fn validates_line_total() {
        let ok = LineItem { quantity: Some(2.0), unit_price: Some(5.0), total: Some(10.0), ..Default::default() };
        let bad = LineItem { quantity: Some(2.0), unit_price: Some(5.0), total: Some(99.0), ..Default::default() };
        assert!(line_total_consistent(&ok));
        assert!(!line_total_consistent(&bad));
    }
}
```

- [ ] **Step 2: Register module** — add `pub mod line_items;` to `src/validate/mod.rs`.

- [ ] **Step 3: Run tests**

Run: `cargo test validate::line_items::`
Expected: 4 passed.

- [ ] **Step 4: Commit**

```powershell
git add -A; git commit -m "feat(validate): line-item code filtering + total check"
```

---

## Task 8: Validation orchestrator

**Files:**
- Modify: `C:\Users\netn1\Downloads\ocr-server\src\validate\mod.rs`

- [ ] **Step 1: Write the failing test** — replace `src/validate/mod.rs` with:

```rust
pub mod numbers;
pub mod dates;
pub mod tax_id;
pub mod vat;
pub mod line_items;

use crate::model::ExtractedData;

/// Run all deterministic checks over a candidate, normalizing fields in place and
/// appending warnings. `vat_rate` is a percentage.
pub fn validate(mut data: ExtractedData, vat_rate: f64) -> ExtractedData {
    // Normalize date.
    if let Some(d) = data.document_date.take() {
        match dates::normalize_date(&d) {
            Some(iso) => data.document_date = Some(iso),
            None => {
                data.document_date = Some(d);
                data.warn("date_unparsed", "Could not normalize document_date to ISO", Some("document_date"));
            }
        }
    }

    // Tax id checksum.
    if let Some(id) = &data.supplier_tax_id {
        if !tax_id::is_valid_israeli_id(id) {
            data.warn("tax_id_invalid", "Supplier tax id failed Israeli checksum", Some("supplier_tax_id"));
        }
    }

    // VAT reconciliation.
    let r = vat::reconcile_vat(data.subtotal, data.vat_amount, data.total_amount, vat_rate);
    data.subtotal = r.subtotal;
    data.vat_amount = r.vat_amount;
    data.total_amount = r.total_amount;
    if !r.consistent {
        data.warn("vat_mismatch", "subtotal + vat does not equal total within 0.01", Some("vat_amount"));
    }

    // Line items.
    data.line_items = line_items::clean_line_items(std::mem::take(&mut data.line_items));
    let bad_lines = data.line_items.iter().filter(|it| !line_items::line_total_consistent(it)).count();
    if bad_lines > 0 {
        data.warn("line_total_mismatch", &format!("{bad_lines} line item(s) where qty*price != total"), Some("line_items"));
    }

    data
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ExtractedData, LineItem};

    #[test]
    fn normalizes_and_reconciles() {
        let input = ExtractedData {
            document_date: Some("31/05/2026".into()),
            subtotal: Some(100.0),
            vat_amount: Some(18.0),
            total_amount: None,
            supplier_tax_id: Some("123456782".into()),
            ..Default::default()
        };
        let out = validate(input, 18.0);
        assert_eq!(out.document_date, Some("2026-05-31".into()));
        assert_eq!(out.total_amount, Some(118.0));
        assert!(out.warnings.is_empty());
    }

    #[test]
    fn warns_on_bad_tax_id_and_vat() {
        let input = ExtractedData {
            supplier_tax_id: Some("123456789".into()),
            subtotal: Some(100.0),
            vat_amount: Some(18.0),
            total_amount: Some(200.0),
            ..Default::default()
        };
        let out = validate(input, 18.0);
        assert!(out.warnings.iter().any(|w| w.code == "tax_id_invalid"));
        assert!(out.warnings.iter().any(|w| w.code == "vat_mismatch"));
    }

    #[test]
    fn strips_code_line_item() {
        let input = ExtractedData {
            line_items: vec![LineItem { description: Some("7290001234567".into()), ..Default::default() }],
            ..Default::default()
        };
        let out = validate(input, 18.0);
        assert_eq!(out.line_items[0].description, None);
    }
}
```

- [ ] **Step 2: Run tests**

Run: `cargo test validate::tests`
Expected: 3 passed (plus all submodule tests still pass: `cargo test validate::`).

- [ ] **Step 3: Commit**

```powershell
git add -A; git commit -m "feat(validate): orchestrator wiring all checks"
```

---

## Task 9: Error type

**Files:**
- Create: `C:\Users\netn1\Downloads\ocr-server\src\error.rs`
- Modify: `src\main.rs`

- [ ] **Step 1: Write `src/error.rs`**

```rust
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    BadRequest(String),
    #[error("unauthorized")]
    Unauthorized,
    #[error("could not extract structured data")]
    Unprocessable,
    #[error("upstream error: {0}")]
    Upstream(String),
    #[error("upstream timeout")]
    UpstreamTimeout,
    #[error("internal error: {0}")]
    Internal(String),
}

impl AppError {
    fn parts(&self) -> (StatusCode, &'static str) {
        match self {
            AppError::BadRequest(_) => (StatusCode::BAD_REQUEST, "bad_request"),
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized"),
            AppError::Unprocessable => (StatusCode::UNPROCESSABLE_ENTITY, "unprocessable"),
            AppError::Upstream(_) => (StatusCode::BAD_GATEWAY, "upstream_error"),
            AppError::UpstreamTimeout => (StatusCode::GATEWAY_TIMEOUT, "upstream_timeout"),
            AppError::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, "internal"),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code) = self.parts();
        let message = self.to_string();
        (status, Json(json!({ "error": { "code": code, "message": message } }))).into_response()
    }
}
```

- [ ] **Step 2: Declare module** — add `mod error;` to `src/main.rs`.

- [ ] **Step 3: Verify it compiles**

Run: `cargo build`
Expected: compiles.

- [ ] **Step 4: Commit**

```powershell
git add -A; git commit -m "feat(error): AppError with JSON IntoResponse"
```

---

## Task 10: App state

**Files:**
- Create: `C:\Users\netn1\Downloads\ocr-server\src\state.rs`
- Modify: `src\main.rs`

- [ ] **Step 1: Write `src/state.rs`**

```rust
use crate::config::Config;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub http: reqwest::Client,
}

impl AppState {
    pub fn new(config: Config) -> Self {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .expect("reqwest client");
        AppState { config: Arc::new(config), http }
    }
}
```

- [ ] **Step 2: Declare module** — add `mod state;` to `src/main.rs`.

- [ ] **Step 3: Verify it compiles**

Run: `cargo build`
Expected: compiles.

- [ ] **Step 4: Commit**

```powershell
git add -A; git commit -m "feat(state): AppState with shared reqwest client"
```

---

## Task 11: Intake — file sniffing

**Files:**
- Create: `C:\Users\netn1\Downloads\ocr-server\src\intake\mod.rs`
- Create: `C:\Users\netn1\Downloads\ocr-server\src\intake\file.rs`
- Modify: `src\main.rs`

- [ ] **Step 1: Write the failing test** (`src/intake/file.rs`)

```rust
/// Detected input kind based on magic bytes (never trust the declared MIME).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Pdf,
    Jpeg,
    Png,
    Webp,
    Heic,
    Unknown,
}

pub fn sniff(bytes: &[u8]) -> Kind {
    if bytes.len() >= 4 && &bytes[0..4] == b"%PDF" {
        return Kind::Pdf;
    }
    if bytes.len() >= 3 && &bytes[0..3] == [0xFF, 0xD8, 0xFF] {
        return Kind::Jpeg;
    }
    if bytes.len() >= 8 && &bytes[0..8] == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] {
        return Kind::Png;
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Kind::Webp;
    }
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        let brand = &bytes[8..12];
        if brand == b"heic" || brand == b"heix" || brand == b"hevc" || brand == b"mif1" {
            return Kind::Heic;
        }
    }
    Kind::Unknown
}

impl Kind {
    /// MIME used when forwarding an image data URL to Mistral.
    pub fn image_mime(self) -> Option<&'static str> {
        match self {
            Kind::Jpeg => Some("image/jpeg"),
            Kind::Png => Some("image/png"),
            Kind::Webp => Some("image/webp"),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sniffs_pdf() {
        assert_eq!(sniff(b"%PDF-1.7\n..."), Kind::Pdf);
    }

    #[test]
    fn sniffs_jpeg() {
        assert_eq!(sniff(&[0xFF, 0xD8, 0xFF, 0xE0, 0x00]), Kind::Jpeg);
    }

    #[test]
    fn sniffs_png() {
        assert_eq!(sniff(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00]), Kind::Png);
    }

    #[test]
    fn unknown_for_text() {
        assert_eq!(sniff(b"hello world"), Kind::Unknown);
    }
}
```

- [ ] **Step 2: Create `src/intake/mod.rs`**

```rust
pub mod file;
```

- [ ] **Step 3: Declare module** — add `mod intake;` to `src/main.rs`.

- [ ] **Step 4: Run tests**

Run: `cargo test intake::file::`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```powershell
git add -A; git commit -m "feat(intake): magic-byte file sniffing"
```

---

## Task 12: Intake — HEIC→JPEG conversion

**Files:**
- Create: `C:\Users\netn1\Downloads\ocr-server\src\intake\image.rs`
- Modify: `src\intake\mod.rs`

> If `libheif-rs` was deferred in Task 0 Step 7, implement `to_jpeg_if_heic` as a pass-through that returns an error for HEIC and skip the conversion test. Otherwise:

- [ ] **Step 1: Write `src/intake/image.rs`**

```rust
use crate::error::AppError;
use crate::intake::file::Kind;

/// Convert HEIC bytes to JPEG bytes. For non-HEIC kinds returns the input untouched.
/// Mistral does not accept HEIC, so we normalize before forwarding.
pub fn to_jpeg_if_heic(kind: Kind, bytes: Vec<u8>) -> Result<(Kind, Vec<u8>), AppError> {
    if kind != Kind::Heic {
        return Ok((kind, bytes));
    }
    let lib = libheif_rs::LibHeif::new();
    let ctx = libheif_rs::HeifContext::read_from_bytes(&bytes)
        .map_err(|e| AppError::BadRequest(format!("invalid HEIC: {e}")))?;
    let handle = ctx.primary_image_handle().map_err(|e| AppError::BadRequest(format!("HEIC: {e}")))?;
    let img = lib
        .decode(&handle, libheif_rs::ColorSpace::Rgb(libheif_rs::RgbChroma::Rgb), None)
        .map_err(|e| AppError::BadRequest(format!("HEIC decode: {e}")))?;
    let planes = img.planes();
    let plane = planes.interleaved.ok_or_else(|| AppError::BadRequest("HEIC: no interleaved plane".into()))?;
    let width = plane.width;
    let height = plane.height;
    let mut rgb = Vec::with_capacity((width * height * 3) as usize);
    for y in 0..height {
        let row = (y * plane.stride as u32) as usize;
        rgb.extend_from_slice(&plane.data[row..row + (width * 3) as usize]);
    }
    let buf = image::RgbImage::from_raw(width, height, rgb)
        .ok_or_else(|| AppError::Internal("HEIC: buffer size mismatch".into()))?;
    let mut out = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(buf)
        .write_to(&mut out, image::ImageFormat::Jpeg)
        .map_err(|e| AppError::Internal(format!("JPEG encode: {e}")))?;
    Ok((Kind::Jpeg, out.into_inner()))
}
```

- [ ] **Step 2: Register module** — add `pub mod image;` to `src/intake/mod.rs`.

- [ ] **Step 3: Verify it compiles**

Run: `cargo build`
Expected: compiles. (Full HEIC decode is exercised in the integration phase with a real sample, not a unit test, since it needs a valid HEIC fixture.)

- [ ] **Step 4: Commit**

```powershell
git add -A; git commit -m "feat(intake): HEIC to JPEG conversion"
```

---

## Task 13: Mistral OCR client (stage 1)

**Files:**
- Create: `C:\Users\netn1\Downloads\ocr-server\src\ocr\mod.rs`
- Create: `C:\Users\netn1\Downloads\ocr-server\src\ocr\mistral.rs`
- Modify: `src\main.rs`

- [ ] **Step 1: Write `src/ocr/mistral.rs`**

```rust
use crate::error::AppError;
use crate::intake::file::Kind;
use crate::state::AppState;
use base64::Engine;
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
struct OcrResponse {
    #[serde(default)]
    pages: Vec<OcrPage>,
}

#[derive(Deserialize)]
struct OcrPage {
    #[serde(default)]
    markdown: String,
}

/// Stage 1: send the document to Mistral OCR, return concatenated markdown.
/// `base_url` lets tests point at a mock server.
pub async fn ocr_markdown(state: &AppState, base_url: &str, kind: Kind, bytes: &[u8]) -> Result<String, AppError> {
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    let document = match kind {
        Kind::Pdf => json!({ "type": "document_url", "document_url": format!("data:application/pdf;base64,{b64}") }),
        _ => {
            let mime = kind.image_mime().ok_or_else(|| AppError::BadRequest("unsupported image type".into()))?;
            json!({ "type": "image_url", "image_url": format!("data:{mime};base64,{b64}") })
        }
    };
    let body = json!({ "model": state.config.ocr_model, "document": document });

    let resp = state
        .http
        .post(format!("{base_url}/v1/ocr"))
        .bearer_auth(&state.config.mistral_api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| if e.is_timeout() { AppError::UpstreamTimeout } else { AppError::Upstream(e.to_string()) })?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Upstream(format!("OCR {status}: {text}")));
    }

    let parsed: OcrResponse = resp.json().await.map_err(|e| AppError::Upstream(e.to_string()))?;
    let md = parsed.pages.iter().map(|p| p.markdown.as_str()).collect::<Vec<_>>().join("\n\n");
    if md.trim().is_empty() {
        return Err(AppError::Unprocessable);
    }
    Ok(md)
}
```

- [ ] **Step 2: Create `src/ocr/mod.rs`**

```rust
pub mod mistral;
```

- [ ] **Step 3: Declare module** — add `mod ocr;` to `src/main.rs`.

- [ ] **Step 4: Write a mocked test** (append to `src/ocr/mistral.rs`)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;
    use std::collections::HashMap;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn test_state() -> AppState {
        let m: HashMap<String, String> = [("MISTRAL_API_KEY", "k"), ("SERVER_API_KEY", "s")]
            .iter().map(|(a, b)| (a.to_string(), b.to_string())).collect();
        AppState::new(Config::from_map(|k| m.get(k).cloned()).unwrap())
    }

    #[tokio::test]
    async fn returns_concatenated_markdown() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).and(path("/v1/ocr"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "pages": [ { "markdown": "# חשבונית" }, { "markdown": "סה\"כ 118" } ]
            })))
            .mount(&server).await;

        let state = test_state();
        let md = ocr_markdown(&state, &server.uri(), Kind::Jpeg, &[0xFF, 0xD8, 0xFF]).await.unwrap();
        assert!(md.contains("חשבונית"));
        assert!(md.contains("118"));
    }

    #[tokio::test]
    async fn maps_500_to_upstream() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).and(path("/v1/ocr"))
            .respond_with(ResponseTemplate::new(500).set_body_string("boom"))
            .mount(&server).await;
        let state = test_state();
        let err = ocr_markdown(&state, &server.uri(), Kind::Jpeg, &[0xFF, 0xD8, 0xFF]).await.unwrap_err();
        assert!(matches!(err, AppError::Upstream(_)));
    }
}
```

- [ ] **Step 5: Run tests**

Run: `cargo test ocr::mistral::`
Expected: 2 passed.

- [ ] **Step 6: Commit**

```powershell
git add -A; git commit -m "feat(ocr): Mistral OCR client (stage 1) + mocked tests"
```

---

## Task 14: Israel-tuned prompt + JSON schema

**Files:**
- Create: `C:\Users\netn1\Downloads\ocr-server\src\ocr\prompt.rs`
- Modify: `src\ocr\mod.rs`

- [ ] **Step 1: Write `src/ocr/prompt.rs`**

```rust
use serde_json::{json, Value};

/// System prompt instructing the model to act as an Israeli-document extraction expert.
pub const SYSTEM_PROMPT: &str = r#"אתה מומחה לחילוץ נתונים ממסמכים עסקיים ישראליים (חשבונית מס, חשבונית מס/קבלה, תעודת משלוח, זיכוי, קבלה, מרכזת).
חלץ אך ורק מה שמופיע במסמך. אל תמציא ערכים. אם שדה חסר — השמט אותו.
- document_type: invoice | delivery_note | credit_note | payment | summary | daily_entry | unknown
- supplier_tax_id: מספר ח.פ / עוסק מורשה (ספרות בלבד).
- תאריכים: כפי שמופיעים (הנרמול ייעשה בצד השרת).
- סכומים: מספרים בלבד (ללא ₪).
- בשורות פריטים העדף תיאור מילולי על פני מק"ט/ברקוד.
- subtotal=לפני מע"מ, vat_amount=המע"מ, total_amount=כולל מע"מ.
החזר JSON תקין בלבד לפי הסכמה."#;

/// JSON schema enforced via Mistral chat `response_format`.
pub fn response_schema() -> Value {
    json!({
        "type": "json_schema",
        "json_schema": {
            "name": "extracted_document",
            "strict": true,
            "schema": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "document_type": { "type": ["string", "null"] },
                    "supplier_name": { "type": ["string", "null"] },
                    "supplier_tax_id": { "type": ["string", "null"] },
                    "document_number": { "type": ["string", "null"] },
                    "document_date": { "type": ["string", "null"] },
                    "discount_amount": { "type": ["number", "null"] },
                    "discount_percentage": { "type": ["number", "null"] },
                    "subtotal": { "type": ["number", "null"] },
                    "vat_amount": { "type": ["number", "null"] },
                    "total_amount": { "type": ["number", "null"] },
                    "line_items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": false,
                            "properties": {
                                "description": { "type": ["string", "null"] },
                                "quantity": { "type": ["number", "null"] },
                                "unit_price": { "type": ["number", "null"] },
                                "discount_amount": { "type": ["number", "null"] },
                                "total": { "type": ["number", "null"] }
                            },
                            "required": ["description", "quantity", "unit_price", "discount_amount", "total"]
                        }
                    },
                    "confidence_score": { "type": ["number", "null"] }
                },
                "required": ["document_type","supplier_name","supplier_tax_id","document_number","document_date","discount_amount","discount_percentage","subtotal","vat_amount","total_amount","line_items","confidence_score"]
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_names_object() {
        let s = response_schema();
        assert_eq!(s["json_schema"]["name"], "extracted_document");
    }
}
```

- [ ] **Step 2: Register module** — add `pub mod prompt;` to `src/ocr/mod.rs`.

- [ ] **Step 3: Run tests**

Run: `cargo test ocr::prompt::`
Expected: 1 passed.

- [ ] **Step 4: Commit**

```powershell
git add -A; git commit -m "feat(ocr): Israel-tuned prompt + JSON schema"
```

---

## Task 15: Structuring client (stage 2)

**Files:**
- Create: `C:\Users\netn1\Downloads\ocr-server\src\ocr\structure.rs`
- Modify: `src\ocr\mod.rs`

- [ ] **Step 1: Write `src/ocr/structure.rs`**

```rust
use crate::error::AppError;
use crate::model::ExtractedData;
use crate::ocr::prompt;
use crate::state::AppState;
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}
#[derive(Deserialize)]
struct Choice {
    message: ChatMessage,
}
#[derive(Deserialize)]
struct ChatMessage {
    content: String,
}

/// Stage 2: ask the chat model to turn markdown into structured JSON.
pub async fn structure(state: &AppState, base_url: &str, markdown: &str) -> Result<ExtractedData, AppError> {
    let body = json!({
        "model": state.config.chat_model,
        "messages": [
            { "role": "system", "content": prompt::SYSTEM_PROMPT },
            { "role": "user", "content": markdown }
        ],
        "response_format": prompt::response_schema(),
        "temperature": 0
    });

    let resp = state
        .http
        .post(format!("{base_url}/v1/chat/completions"))
        .bearer_auth(&state.config.mistral_api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| if e.is_timeout() { AppError::UpstreamTimeout } else { AppError::Upstream(e.to_string()) })?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Upstream(format!("chat {status}: {text}")));
    }

    let parsed: ChatResponse = resp.json().await.map_err(|e| AppError::Upstream(e.to_string()))?;
    let content = parsed.choices.first().map(|c| c.message.content.as_str()).unwrap_or("");
    let mut data: ExtractedData = serde_json::from_str(content).map_err(|_| AppError::Unprocessable)?;
    data.raw_text = Some(markdown.to_string());
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;
    use std::collections::HashMap;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn test_state() -> AppState {
        let m: HashMap<String, String> = [("MISTRAL_API_KEY", "k"), ("SERVER_API_KEY", "s")]
            .iter().map(|(a, b)| (a.to_string(), b.to_string())).collect();
        AppState::new(Config::from_map(|k| m.get(k).cloned()).unwrap())
    }

    #[tokio::test]
    async fn parses_structured_json() {
        let server = MockServer::start().await;
        let content = serde_json::json!({
            "document_type": "invoice", "supplier_name": "ספק בע\"מ",
            "supplier_tax_id": "123456782", "document_number": "1001",
            "document_date": "31/05/2026", "discount_amount": null, "discount_percentage": null,
            "subtotal": 100.0, "vat_amount": 18.0, "total_amount": 118.0,
            "line_items": [], "confidence_score": 0.9
        }).to_string();
        Mock::given(method("POST")).and(path("/v1/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "choices": [ { "message": { "content": content } } ]
            })))
            .mount(&server).await;

        let state = test_state();
        let data = structure(&state, &server.uri(), "# חשבונית").await.unwrap();
        assert_eq!(data.supplier_name.as_deref(), Some("ספק בע\"מ"));
        assert_eq!(data.total_amount, Some(118.0));
        assert_eq!(data.raw_text.as_deref(), Some("# חשבונית"));
    }
}
```

- [ ] **Step 2: Register module** — add `pub mod structure;` to `src/ocr/mod.rs`.

- [ ] **Step 3: Run tests**

Run: `cargo test ocr::structure::`
Expected: 1 passed.

> Note: `ExtractedData` must deserialize `document_type: "invoice"` into the enum. The `#[serde(rename_all="snake_case")]` on `DocumentType` handles this. A `null` document_type deserializes to `None` because the field is `Option<DocumentType>`.

- [ ] **Step 4: Commit**

```powershell
git add -A; git commit -m "feat(ocr): structuring client (stage 2) + mocked test"
```

---

## Task 16: Auth middleware

**Files:**
- Create: `C:\Users\netn1\Downloads\ocr-server\src\middleware\mod.rs`
- Create: `C:\Users\netn1\Downloads\ocr-server\src\middleware\auth.rs`
- Modify: `src\main.rs`

- [ ] **Step 1: Write `src/middleware/auth.rs`**

```rust
use crate::error::AppError;
use crate::state::AppState;
use axum::extract::{Request, State};
use axum::middleware::Next;
use axum::response::Response;

/// Reject requests whose Bearer token does not match SERVER_API_KEY.
pub async fn require_bearer(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let header = req
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let token = header.strip_prefix("Bearer ").unwrap_or("");
    if token.is_empty() || token != state.config.server_api_key {
        return Err(AppError::Unauthorized);
    }
    Ok(next.run(req).await)
}
```

- [ ] **Step 2: Create `src/middleware/mod.rs`**

```rust
pub mod auth;
```

- [ ] **Step 3: Declare module** — add `mod middleware;` to `src/main.rs`.

- [ ] **Step 4: Verify it compiles**

Run: `cargo build`
Expected: compiles.

- [ ] **Step 5: Commit**

```powershell
git add -A; git commit -m "feat(middleware): bearer-token auth guard"
```

---

## Task 17: Routes — health + extract

**Files:**
- Create: `C:\Users\netn1\Downloads\ocr-server\src\routes\mod.rs`
- Create: `C:\Users\netn1\Downloads\ocr-server\src\routes\health.rs`
- Create: `C:\Users\netn1\Downloads\ocr-server\src\routes\extract.rs`
- Modify: `src\main.rs`

- [ ] **Step 1: Write `src/routes/health.rs`**

```rust
use axum::Json;
use serde_json::{json, Value};

pub async fn health() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}
```

- [ ] **Step 2: Write `src/routes/extract.rs`**

```rust
use crate::error::AppError;
use crate::intake::{file, image};
use crate::ocr::{mistral, structure};
use crate::state::AppState;
use crate::validate;
use axum::extract::{Multipart, Query, State};
use axum::Json;
use serde::Deserialize;
use crate::model::ExtractedData;

const MISTRAL_BASE: &str = "https://api.mistral.ai";

#[derive(Deserialize)]
pub struct ExtractParams {
    pub vat_rate: Option<f64>,
}

pub async fn extract(
    State(state): State<AppState>,
    Query(params): Query<ExtractParams>,
    mut multipart: Multipart,
) -> Result<Json<ExtractedData>, AppError> {
    // Read the `file` part.
    let mut bytes: Option<Vec<u8>> = None;
    while let Some(field) = multipart.next_field().await.map_err(|e| AppError::BadRequest(e.to_string()))? {
        if field.name() == Some("file") {
            let data = field.bytes().await.map_err(|e| AppError::BadRequest(e.to_string()))?;
            bytes = Some(data.to_vec());
        }
    }
    let bytes = bytes.ok_or_else(|| AppError::BadRequest("missing 'file' field".into()))?;
    if bytes.len() > state.config.max_upload_bytes {
        return Err(AppError::BadRequest("file too large".into()));
    }

    // Sniff + normalize.
    let kind = file::sniff(&bytes);
    if kind == file::Kind::Unknown {
        return Err(AppError::BadRequest("unsupported file type".into()));
    }
    let (kind, bytes) = image::to_jpeg_if_heic(kind, bytes)?;

    // Stage 1 + 2 + 3.
    let markdown = mistral::ocr_markdown(&state, MISTRAL_BASE, kind, &bytes).await?;
    let candidate = structure::structure(&state, MISTRAL_BASE, &markdown).await?;
    let vat_rate = params.vat_rate.unwrap_or(state.config.vat_rate);
    let result = validate::validate(candidate, vat_rate);

    Ok(Json(result))
}
```

- [ ] **Step 3: Write `src/routes/mod.rs`**

```rust
pub mod extract;
pub mod health;

use crate::middleware::auth::require_bearer;
use crate::state::AppState;
use axum::routing::{get, post};
use axum::{middleware, Router};

pub fn build_router(state: AppState) -> Router {
    let protected = Router::new()
        .route("/v1/extract", post(extract::extract))
        .layer(middleware::from_fn_with_state(state.clone(), require_bearer));

    Router::new()
        .route("/health", get(health::health))
        .merge(protected)
        .with_state(state)
}
```

- [ ] **Step 4: Declare module** — add `mod routes;` to `src/main.rs`.

- [ ] **Step 5: Verify it compiles**

Run: `cargo build`
Expected: compiles.

- [ ] **Step 6: Commit**

```powershell
git add -A; git commit -m "feat(routes): health + extract endpoints with router"
```

---

## Task 18: main.rs bootstrap

**Files:**
- Modify: `C:\Users\netn1\Downloads\ocr-server\src\main.rs`

- [ ] **Step 1: Replace `src/main.rs` entirely**

```rust
mod config;
mod error;
mod intake;
mod middleware;
mod model;
mod ocr;
mod routes;
mod state;
mod validate;

use config::Config;
use state::AppState;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env().add_directive("info".parse().unwrap()))
        .init();

    let config = Config::from_env().unwrap_or_else(|e| {
        eprintln!("config error: {e}");
        std::process::exit(1);
    });
    let port = config.port;
    let state = AppState::new(config);
    let app = routes::build_router(state);

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    axum::serve(listener, app).await.expect("serve");
}
```

- [ ] **Step 2: Verify it builds and warnings are clean**

Run: `cargo build 2>&1 | Select-String -Pattern "warning|error"`
Expected: no errors. Fix any unused-import warnings inline.

- [ ] **Step 3: Run the full unit suite**

Run: `cargo test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```powershell
git add -A; git commit -m "feat: wire main bootstrap + router"
```

---

## Task 19: End-to-end integration test (Mistral mocked)

**Files:**
- Create: `C:\Users\netn1\Downloads\ocr-server\tests\integration.rs`

> This test exercises the validate + structuring path against a mock. Because the route hardcodes `MISTRAL_BASE`, refactor `extract` to read the base URL from `AppState` so tests can inject a mock.

- [ ] **Step 1: Add `mistral_base` to Config and AppState**

In `src/config.rs` add field `pub mistral_base: String,` and in `from_map` add:
```rust
mistral_base: get("MISTRAL_BASE").unwrap_or_else(|| "https://api.mistral.ai".into()),
```
Add a test asserting the default:
```rust
#[test]
fn defaults_mistral_base() {
    let cfg = Config::from_map(map(&[("MISTRAL_API_KEY","m"),("SERVER_API_KEY","s")])).unwrap();
    assert_eq!(cfg.mistral_base, "https://api.mistral.ai");
}
```

- [ ] **Step 2: Use it in `src/routes/extract.rs`** — remove the `MISTRAL_BASE` const and replace both call sites:
```rust
let base = state.config.mistral_base.clone();
let markdown = mistral::ocr_markdown(&state, &base, kind, &bytes).await?;
let candidate = structure::structure(&state, &base, &markdown).await?;
```

- [ ] **Step 3: Make `build_router` and `AppState::new` reachable from the integration test** — they are already `pub`. Ensure `lib`-style access: add `src/lib.rs` re-exporting modules, OR keep the integration test minimal by testing through HTTP only. Create `src/lib.rs`:
```rust
pub mod config;
pub mod error;
pub mod intake;
pub mod middleware;
pub mod model;
pub mod ocr;
pub mod routes;
pub mod state;
pub mod validate;
```
And change `src/main.rs` to use the crate: replace the `mod ...;` block with `use ocr_server::{config::Config, routes, state::AppState};`.

- [ ] **Step 4: Write `tests/integration.rs`**

```rust
use ocr_server::{config::Config, routes, state::AppState};
use std::collections::HashMap;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

async fn spawn(base: &str) -> String {
    let m: HashMap<String, String> = [
        ("MISTRAL_API_KEY", "k"), ("SERVER_API_KEY", "secret"), ("MISTRAL_BASE", base),
    ].iter().map(|(a, b)| (a.to_string(), b.to_string())).collect();
    let cfg = Config::from_map(|k| m.get(k).cloned()).unwrap();
    let app = routes::build_router(AppState::new(cfg));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap(); });
    format!("http://{addr}")
}

#[tokio::test]
async fn extract_happy_path() {
    let mistral = MockServer::start().await;
    Mock::given(method("POST")).and(path("/v1/ocr"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "pages": [ { "markdown": "# חשבונית מס\nסה\"כ 118" } ]
        }))).mount(&mistral).await;
    let content = serde_json::json!({
        "document_type":"invoice","supplier_name":"ספק","supplier_tax_id":"123456782",
        "document_number":"1001","document_date":"31/05/2026","discount_amount":null,
        "discount_percentage":null,"subtotal":100.0,"vat_amount":18.0,"total_amount":null,
        "line_items":[],"confidence_score":0.9
    }).to_string();
    Mock::given(method("POST")).and(path("/v1/chat/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "choices": [ { "message": { "content": content } } ]
        }))).mount(&mistral).await;

    let app_url = spawn(&mistral.uri()).await;
    let client = reqwest::Client::new();
    let part = reqwest::multipart::Part::bytes(vec![0xFF, 0xD8, 0xFF, 0xE0]).file_name("a.jpg");
    let form = reqwest::multipart::Form::new().part("file", part);

    let resp = client.post(format!("{app_url}/v1/extract"))
        .bearer_auth("secret").multipart(form).send().await.unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["supplier_name"], "ספק");
    assert_eq!(body["document_date"], "2026-05-31"); // normalized
    assert_eq!(body["total_amount"], 118.0);          // back-filled
}

#[tokio::test]
async fn rejects_missing_token() {
    let mistral = MockServer::start().await;
    let app_url = spawn(&mistral.uri()).await;
    let client = reqwest::Client::new();
    let form = reqwest::multipart::Form::new()
        .part("file", reqwest::multipart::Part::bytes(vec![0xFF, 0xD8, 0xFF]).file_name("a.jpg"));
    let resp = client.post(format!("{app_url}/v1/extract")).multipart(form).send().await.unwrap();
    assert_eq!(resp.status(), 401);
}
```

- [ ] **Step 5: Add `reqwest` multipart to dev-deps** — in `Cargo.toml` under `[dev-dependencies]` add `reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls", "multipart"] }`.

- [ ] **Step 6: Run the integration test**

Run: `cargo test --test integration`
Expected: 2 passed.

- [ ] **Step 7: Commit**

```powershell
git add -A; git commit -m "test: end-to-end extract integration with mocked Mistral"
```

---

## Task 20: Dockerfile + docs

**Files:**
- Create: `C:\Users\netn1\Downloads\ocr-server\Dockerfile`
- Create: `C:\Users\netn1\Downloads\ocr-server\README.md`

- [ ] **Step 1: Write `Dockerfile`**

```dockerfile
# ---- build ----
FROM rust:1-slim AS builder
RUN apt-get update && apt-get install -y pkg-config libheif-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY Cargo.toml ./
COPY src ./src
COPY tests ./tests
RUN cargo build --release

# ---- runtime ----
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y libheif1 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/ocr-server /usr/local/bin/ocr-server
EXPOSE 8080
ENV PORT=8080
CMD ["ocr-server"]
```

- [ ] **Step 2: Write `README.md`**

````markdown
# ocr-server

Standalone Rust service: image/PDF of an Israeli business document → validated structured JSON.

## Run locally
```bash
cp .env.example .env   # fill MISTRAL_API_KEY + SERVER_API_KEY
cargo run
```

## API
`POST /v1/extract` — `multipart/form-data` with `file`. Header `Authorization: Bearer <SERVER_API_KEY>`.
Optional query: `?vat_rate=18`.

```bash
curl -X POST http://localhost:8080/v1/extract \
  -H "Authorization: Bearer $SERVER_API_KEY" \
  -F file=@invoice.pdf
```

`GET /health` → `{"status":"ok"}`.
````

- [ ] **Step 3: Verify release build (optional, slow)**

Run: `cargo build --release`
Expected: compiles.

- [ ] **Step 4: Commit**

```powershell
git add -A; git commit -m "chore: Dockerfile + README"
```

---

## Self-Review Notes (verified against spec §1–§12)

- §2 two-stage + validation → Tasks 13/15 + 8.
- §5 endpoints (extract w/ auth, health, vat_rate query) → Tasks 16/17.
- §6 output contract (ExtractedData mirroring TS + warnings) → Task 2; bbox/field_confidence are listed as optional extensions in the spec — **field_confidence and bbox are deferred** (not implemented in this plan; `warnings` and `confidence_score` are). This is a deliberate scope cut for v0.1; note for a follow-up.
- §7 Israeli validators → Tasks 3–7.
- §8 error mapping → Task 9.
- §9 tests (unit + mocked integration) → every validator task + Tasks 13/15/19.
- §10 deployment → Task 20.
- Type consistency: `ExtractedData`, `LineItem`, `DocumentType`, `Kind`, `AppError`, `AppState`, `Config` names used consistently across tasks.
```

> **Deferred from spec (call out to user):** per-field `field_confidence` map and `bbox` output (spec §6) are NOT in this plan — v0.1 ships `warnings[]` + overall `confidence_score`. HEIC conversion (Task 12) depends on a libheif-capable build environment.
