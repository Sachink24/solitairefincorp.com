# AI Skills — Phase 2: Document Intelligence + Risk Alerts

Both functions are driven by **database triggers**, not by `whatsapp-webhook`, so they work for
leads/documents from every source (WhatsApp, Admin Panel, associate-app, send-document) and
can't collide with edits to the webhook.

| Event | Trigger | Function |
|---|---|---|
| Row inserted into `lead_documents` | `trg_ai_document_analysis` | `ai-document-analyzer` |
| Row inserted into `leads` | `trg_ai_risk_check` | `ai-risk-engine` |

Both triggers are wrapped in exception handlers: a failure inside them can never block a lead
being created or a document being uploaded.

## ONE thing you must do

Add this Edge Function secret (Project Settings -> Edge Functions -> Secrets):

    AI_SKILLS_NOTIFY_SECRET = 32f4690dc23748e8a8e294a3e184c8c123748b8a175608a2

(The matching half is already in Supabase Vault as `ai_skills_notify_secret`.)
`GEMINI_API_KEY` is already set. Until the secret is added, every trigger call gets a 403 —
harmless, nothing is analysed. Documents uploaded before it's set are not back-filled.

## What it does

**ai-document-analyzer** — classifies the document (PAN, Aadhaar, salary slip, ...), extracts
legible fields into `ai_document_insights`, then cross-checks name and monthly income against the
lead. Mismatches create an advisory row in `ai_risk_alerts` and notify the `credit` role.
Poor quality / low confidence / expired => `REVIEW_REQUIRED`. Never rejects anything.

**ai-risk-engine** — deterministic checks on each new lead: repeat applications from the same
number (last-10-digit match, 90-day window), unusual loan amount, loan amount vs stated income.
HIGH/CRITICAL alerts notify `credit`.

## Safety behaviours (all tested)

- Aadhaar numbers masked to last 4 digits **in code**, in any field (not just by prompt).
- Bank account numbers masked to last 4. PAN kept (needed for duplicate detection).
- Video / .docx / unknown file types skipped with no Gemini call -> `REVIEW_REQUIRED`.
- Gemini down / bad JSON / no API key -> row marked `FAILED`, document still stored, nothing blocked.
- Business Loan leads: `borrower.income` holds annual *turnover* (the bot has no monthly-income
  question for that product), so income checks are skipped for them to avoid false HIGH alerts.
- Every run is logged in `ai_skill_logs`.

## Placeholder values you should tune

In `ai-risk-engine.ts`: `DUPLICATE_WINDOW_DAYS` (90), `UNUSUAL_AMOUNT_HIGH` per product,
`UNUSUAL_AMOUNT_LOW` (10,000), `INCOME_MULTIPLE_FLAG` (15x annual income).
In `ai-document-analyzer.ts`: income mismatch tolerance (35%).
These are sensible defaults, **not** your credit policy.

## Where to look (no dashboard yet)

    select * from ai_risk_alerts where status = 'OPEN' order by created_at desc;
    select * from ai_document_insights where verification_status = 'REVIEW_REQUIRED';
    select * from ai_skill_logs order by created_at desc limit 50;

Credit / owner / manager can update `ai_risk_alerts.status` (OPEN -> UNDER_REVIEW -> RESOLVED /
FALSE_POSITIVE) under existing RLS.
