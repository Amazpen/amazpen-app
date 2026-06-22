-- מספר הקצאה (Israeli Tax Authority allocation number)
-- Captured during OCR intake for invoices whose total INCLUDING VAT reaches the
-- legal threshold. The OCR form (OCRForm.tsx) surfaces the input only once the
-- total crosses ALLOCATION_NUMBER_MIN_TOTAL (5000), and the value is persisted
-- here for both the regular invoice and מרכזת (summary) flows.

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS allocation_number text;

COMMENT ON COLUMN public.invoices.allocation_number IS
  'מספר הקצאה - Israeli Tax Authority allocation number; captured during OCR intake for invoices whose total incl VAT reaches the legal threshold.';
