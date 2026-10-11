// =========================================================
// SOLITAIRE FINZ MART — ai-document-analyzer
// Triggered by trg_ai_document_analysis (AFTER INSERT on lead_documents)
// for EVERY document uploaded anywhere in the system (WhatsApp, staff
// upload via send-document, etc.) — not wired into whatsapp-webhook at
// all, deliberately, since that file is under active separate development.
//
// Classifies the document, extracts whichever fields are legible, masks
// sensitive numbers to last 4 digits, and cross-checks extracted income/
// name against the lead's declared borrower info — raising an advisory
// risk alert on a meaningful mismatch, never auto-rejecting anything.
//
// Auth: verify_jwt is OFF (caller is Postgres via pg_net). Verified instead
// via a shared secret header, same pattern as whatsapp-notify.
//
// Failure handling: if Gemini is unavailable, the document is still safely
// stored (that already happened before this trigger fires) — this function
// just marks the insight row FAILED and logs it, never blocks anything.
// =========================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash";
const AI_SKILLS_NOTIFY_SECRET = Deno.env.get("AI_SKILLS_NOTIFY_SECRET")!;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const DOCUMENT_TYPES = [
  "PAN", "Aadhaar", "Bank Statement", "Salary Slip", "ITR", "GST Returns",
  "Business Proof", "Property Documents", "Sale Agreement", "Title Documents",
  "Income Proof", "Address Proof", "Photograph", "Registration Document",
  "Electricity Bill", "Identity Proof", "Other",
];

const EXTRACTION_PROMPT = `You are a document classification and data-extraction assistant for SOLITAIRE FINZ MART, a loan advisory business in India, reviewing a document submitted by a loan applicant.

Classify the document as exactly one of: ${DOCUMENT_TYPES.join(", ")}.

Then extract whichever of these fields are actually present and legible: document_number, name, date_of_birth, address, issue_date, expiry_date, employer, monthly_income, annual_income, financial_year, bank_name, account_number_masked (LAST 4 DIGITS ONLY — never the full number), property_details, registration_details.

Also assess:
- classification_confidence: a number from 0 to 1
- expiry_status: one of "not_applicable", "valid", "expired", "expiring_soon", "unknown"
- quality_issues: an array of short strings describing any readability/quality problems (empty array if none)
- summary: one short sentence describing the document for a staff member who hasn't seen it

Respond with ONLY a JSON object with these exact keys: document_type, classification_confidence, extracted_data (an object), expiry_status, quality_issues (array of strings), summary.

Never invent information not visible in the document. If a field isn't present or legible, omit it from extracted_data entirely. Never return a full bank account number, full Aadhaar number, or other complete sensitive identifier beyond what verification needs — mask account numbers to last 4 digits only.`;

async function logSkill(skillName: string, leadId: number | null, inputSummary: string, status: "SUCCESS" | "FAILED" | "SKIPPED", outputSummary?: string, confidence?: number, error?: string) {
  try {
    await sb.from("ai_skill_logs").insert({
      skill_name: skillName,
      lead_id: leadId,
      input_summary: inputSummary,
      output_summary: outputSummary ?? null,
      model: GEMINI_MODEL,
      confidence: confidence ?? null,
      status,
      error: error ?? null,
    });
  } catch (e) {
    console.error("logSkill failed", e);
  }
}

async function notifyCredit(leadId: number, title: string, message: string) {
  try {
    await sb.rpc("create_notification", {
      p_lead_id: leadId,
      p_recipient_email: null,
      p_recipient_role: "credit",
      p_type: "ai_document_risk",
      p_title: title,
      p_message: message,
    });
  } catch (e) {
    console.error("notifyCredit failed", e);
  }
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function callGeminiVision(mimeType: string, base64Data: string): Promise<Record<string, unknown> | null> {
  if (!GEMINI_API_KEY) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [
              { inlineData: { mimeType, data: base64Data } },
              { text: EXTRACTION_PROMPT },
            ],
          }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 800, responseMimeType: "application/json" },
        }),
      },
    );
    if (!res.ok) {
      console.error("Gemini vision API error", res.status, await res.text());
      return null;
    }
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    return JSON.parse(text);
  } catch (err) {
    console.error("Gemini vision call failed", err);
    return null;
  }
}

// File types Gemini can actually read. Anything else (video, docx, unknown)
// is marked for manual review instead of burning a call that's guaranteed
// to fail.
const SUPPORTED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

// Privacy is enforced HERE, deterministically — never rely on the prompt
// alone. LLM instructions ("never return a full Aadhaar number") are not a
// reliable control; this runs on whatever the model actually returned.
//  - Aadhaar numbers (12 digits, with or without spaces) are masked to the
//    last 4 digits anywhere they appear, in any field.
//  - Bank account numbers are masked to the last 4 digits.
// PAN is intentionally left intact: it's needed for duplicate detection and
// is routinely held by lenders for KYC.
const AADHAAR_PATTERN = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g;

function maskDigitsKeepLast4(value: string, prefix = "XXXX"): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 4) return value;
  return `${prefix}${digits.slice(-4)}`;
}

function maskSensitive(documentType: string, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(data)) {
    let value = raw;
    if (typeof value === "string") {
      // Any 12-digit Aadhaar-shaped number, wherever the model put it.
      value = value.replace(AADHAAR_PATTERN, (m) => `XXXX XXXX ${m.replace(/\D/g, "").slice(-4)}`);
      if (key === "document_number" && documentType === "Aadhaar") {
        value = maskDigitsKeepLast4(value as string, "XXXX XXXX ");
      }
      if (key === "account_number_masked" || key === "account_number") {
        value = maskDigitsKeepLast4(value as string, "XXXXXX");
      }
    } else if (typeof value === "number" && (key === "account_number_masked" || key === "account_number")) {
      value = maskDigitsKeepLast4(String(value), "XXXXXX");
    }
    out[key === "account_number" ? "account_number_masked" : key] = value;
  }
  return out;
}

// borrower.income arrives as a number from the WhatsApp bot but may be a
// string ("50,000", "₹50000") when written by other apps — accept both.
function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.replace(/[₹,\s]/g, ""));
    return Number.isFinite(n) && v.trim() !== "" ? n : null;
  }
  return null;
}

// Very loose fuzzy match — just checks whether the two names share at
// least one meaningful word. Good enough to catch a clean mismatch
// without false-flagging minor spelling/order differences.
function namesLikelyMatch(a: string, b: string): boolean {
  const wordsA = a.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter((w) => w.length > 2);
  const wordsB = b.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter((w) => w.length > 2);
  return wordsA.some((w) => wordsB.includes(w));
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const secret = req.headers.get("x-ai-skills-secret");
  if (!secret || secret !== AI_SKILLS_NOTIFY_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response("Bad payload", { status: 400 });
  }

  const documentId = body?.document_id;
  const leadId = body?.lead_id;
  if (!documentId || !leadId) return new Response("Missing document_id or lead_id", { status: 400 });

  const { data: doc } = await sb.from("lead_documents").select("*").eq("id", documentId).maybeSingle();
  if (!doc) {
    await logSkill("ai-document-analyzer", leadId, `document_id=${documentId}`, "FAILED", undefined, undefined, "Document row not found");
    return new Response("Document not found", { status: 200 });
  }

  // Create the PENDING insight row immediately so staff can see analysis
  // is in progress, before we even attempt the (slower) Gemini call.
  const { data: insight } = await sb.from("ai_document_insights").insert({
    lead_id: leadId,
    document_id: documentId,
    verification_status: "PROCESSING",
  }).select("id").single();

  if (!GEMINI_API_KEY) {
    await sb.from("ai_document_insights").update({
      verification_status: "FAILED",
      ai_summary: "AI analysis unavailable (GEMINI_API_KEY not configured). Document stored successfully and awaits manual review.",
      updated_at: new Date().toISOString(),
    }).eq("id", insight?.id);
    await logSkill("ai-document-analyzer", leadId, doc.file_name ?? documentId, "SKIPPED", undefined, undefined, "GEMINI_API_KEY not set");
    return new Response("Gemini not configured, skipped", { status: 200 });
  }

  if (!SUPPORTED_MIME_TYPES.has(String(doc.mime_type ?? "").toLowerCase())) {
    await sb.from("ai_document_insights").update({
      verification_status: "REVIEW_REQUIRED",
      ai_summary: `File type (${doc.mime_type ?? "unknown"}) is not supported for AI analysis. Document stored successfully and awaits manual review.`,
      updated_at: new Date().toISOString(),
    }).eq("id", insight?.id);
    await logSkill("ai-document-analyzer", leadId, `${doc.file_name ?? documentId} (${doc.mime_type})`, "SKIPPED", undefined, undefined, "Unsupported mime type");
    return new Response("Unsupported file type, marked for manual review", { status: 200 });
  }

  const { data: fileBlob, error: downloadError } = await sb.storage.from("lead-documents").download(doc.storage_path);
  if (downloadError || !fileBlob) {
    await sb.from("ai_document_insights").update({
      verification_status: "FAILED",
      ai_summary: "Could not retrieve the stored file for analysis.",
      updated_at: new Date().toISOString(),
    }).eq("id", insight?.id);
    await logSkill("ai-document-analyzer", leadId, doc.file_name ?? documentId, "FAILED", undefined, undefined, String(downloadError));
    return new Response("Download failed, marked FAILED", { status: 200 });
  }

  const bytes = new Uint8Array(await fileBlob.arrayBuffer());
  const base64Data = base64Encode(bytes);
  const result = await callGeminiVision(doc.mime_type ?? "application/octet-stream", base64Data);

  if (!result) {
    await sb.from("ai_document_insights").update({
      verification_status: "FAILED",
      ai_summary: "AI analysis failed (Gemini unavailable or returned an unreadable response). Document stored successfully and awaits manual review.",
      updated_at: new Date().toISOString(),
    }).eq("id", insight?.id);
    await logSkill("ai-document-analyzer", leadId, doc.file_name ?? documentId, "FAILED", undefined, undefined, "Gemini call failed or returned invalid JSON");
    return new Response("Analysis failed, marked FAILED", { status: 200 });
  }

  const documentType = typeof result.document_type === "string" && DOCUMENT_TYPES.includes(result.document_type) ? result.document_type : "Other";
  const confidence = typeof result.classification_confidence === "number" ? Math.max(0, Math.min(1, result.classification_confidence)) : null;
  const rawExtracted: Record<string, unknown> = typeof result.extracted_data === "object" && result.extracted_data !== null ? (result.extracted_data as Record<string, unknown>) : {};
  // Mask immediately — nothing unmasked is ever written anywhere below.
  const extractedData = maskSensitive(documentType, rawExtracted);
  const expiryStatus = typeof result.expiry_status === "string" ? result.expiry_status : "unknown";
  const qualityIssues = Array.isArray(result.quality_issues) ? result.quality_issues : [];
  const summary = typeof result.summary === "string" ? result.summary : null;

  const lowConfidence = confidence !== null && confidence < 0.6;
  const verificationStatus = lowConfidence || qualityIssues.length > 0 || expiryStatus === "expired" ? "REVIEW_REQUIRED" : "COMPLETED";

  // Cross-check against the lead's declared information — advisory only,
  // never a rejection. A mismatch becomes a risk alert for Credit to look at.
  const { data: lead } = await sb.from("leads").select("borrower, loan_type").eq("id", leadId).maybeSingle();
  const borrower: Record<string, unknown> = lead?.borrower ?? {};
  const riskFlags: string[] = [];

  const extractedName = extractedData.name as string | undefined;
  if (extractedName && borrower.name && !namesLikelyMatch(extractedName, String(borrower.name))) {
    riskFlags.push("Name on document does not clearly match applicant name on file");
    await sb.from("ai_risk_alerts").insert({
      lead_id: leadId,
      risk_type: "name_mismatch",
      severity: "MEDIUM",
      title: "Name mismatch between document and application",
      description: `The name extracted from an uploaded ${documentType} does not clearly match the applicant's declared name.`,
      evidence: { document_id: documentId, document_type: documentType, declared_name: borrower.name, document_name: extractedName },
      recommended_action: "Manual verification required.",
    });
    await notifyCredit(leadId, "Document name mismatch", `A ${documentType} uploaded for this lead has a name that doesn't clearly match the application.`);
  }

  const extractedIncome = typeof extractedData.monthly_income === "number"
    ? extractedData.monthly_income
    : typeof extractedData.annual_income === "number" ? extractedData.annual_income / 12 : null;
  // IMPORTANT: for Business Loan leads the WhatsApp bot stores annual
  // TURNOVER in borrower.income (there is no monthly-income question in that
  // flow), so comparing it to a salary slip would raise a false HIGH alert.
  // Only compare when the declared figure is genuinely a monthly income.
  const declaredIncomeIsTurnover = lead?.loan_type === "Business Loan";
  const declaredIncome = declaredIncomeIsTurnover ? null : toNumber(borrower.income);
  if (extractedIncome !== null && declaredIncome !== null && declaredIncome > 0) {
    const diffRatio = Math.abs(extractedIncome - declaredIncome) / declaredIncome;
    if (diffRatio > 0.35) {
      riskFlags.push("Income on document differs significantly from declared income");
      await sb.from("ai_risk_alerts").insert({
        lead_id: leadId,
        risk_type: "income_mismatch",
        severity: "HIGH",
        title: "Income mismatch between document and application",
        description: `Declared income (₹${Math.round(declaredIncome).toLocaleString("en-IN")}/month) differs from the income reflected in an uploaded ${documentType} (₹${Math.round(extractedIncome).toLocaleString("en-IN")}/month).`,
        evidence: { document_id: documentId, document_type: documentType, declared_income: declaredIncome, document_income: extractedIncome },
        recommended_action: "Manual Credit Review Required.",
      });
      await notifyCredit(leadId, "Income mismatch detected", `A ${documentType} shows income differing from what was declared — manual review recommended.`);
    }
  }

  await sb.from("ai_document_insights").update({
    document_type: documentType,
    classification_confidence: confidence,
    extracted_data: extractedData,
    missing_fields: [],
    expiry_status: expiryStatus,
    verification_status: verificationStatus,
    risk_flags: riskFlags,
    ai_summary: summary,
    updated_at: new Date().toISOString(),
  }).eq("id", insight?.id);

  await logSkill("ai-document-analyzer", leadId, `${doc.file_name ?? documentId} (${documentType})`, "SUCCESS", summary ?? undefined, confidence ?? undefined);

  return new Response(JSON.stringify({ document_type: documentType, verification_status: verificationStatus }), { status: 200, headers: { "Content-Type": "application/json" } });
});
