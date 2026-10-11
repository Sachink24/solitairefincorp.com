// =========================================================
// SOLITAIRE FINZ MART — ai-risk-engine
// Triggered by trg_ai_risk_check (AFTER INSERT on leads) for EVERY new
// lead, regardless of source (WhatsApp, Admin Panel, associate-app) — not
// wired into whatsapp-webhook, deliberately, since that file is under
// active separate development.
//
// Runs deterministic duplicate/pattern checks (NOT AI judgment calls —
// matching the spec's requirement that fraud detection be evidence-based,
// not free-form AI opinion) and raises advisory ai_risk_alerts rows.
// NEVER modifies the lead, never blocks it, never auto-rejects anything —
// only notifies Credit/Owner for manual review.
//
// IMPORTANT: the numeric thresholds below (duplicate window, loan-amount
// bands, income-multiple) are placeholder defaults, not real credit
// policy — Solitaire Finz Mart should review and tune these based on
// actual lending experience. They are intentionally conservative (flag
// rather than miss) since false positives here just mean "a human looks
// at it," not any customer-facing consequence.
//
// Auth: verify_jwt is OFF (caller is Postgres via pg_net). Verified via a
// shared secret header, same pattern as whatsapp-notify.
// =========================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AI_SKILLS_NOTIFY_SECRET = Deno.env.get("AI_SKILLS_NOTIFY_SECRET")!;
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---- Placeholder thresholds — tune these for your actual business ----
const DUPLICATE_WINDOW_DAYS = 90;
const UNUSUAL_AMOUNT_HIGH: Record<string, number> = {
  "Personal Loan": 2500000,
  "Vehicle Loan": 5000000,
  "Business Loan": 50000000,
  "Home Loan": 50000000,
  "Loan Against Property": 50000000,
  "Project Finance": 100000000,
};
const UNUSUAL_AMOUNT_LOW = 10000;
const INCOME_MULTIPLE_FLAG = 15; // flag if loan_amount > 15x annual income
// ------------------------------------------------------------------

function last10(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "").slice(-10);
}

// borrower.income may be a number or a numeric string depending on which app
// wrote the lead — accept both.
function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.replace(/[₹,\s]/g, ""));
    return Number.isFinite(n) && v.trim() !== "" ? n : null;
  }
  return null;
}

async function logSkill(leadId: number, status: "SUCCESS" | "FAILED", outputSummary?: string, error?: string) {
  try {
    await sb.from("ai_skill_logs").insert({
      skill_name: "ai-risk-engine",
      lead_id: leadId,
      input_summary: `lead_id=${leadId}`,
      output_summary: outputSummary ?? null,
      model: GEMINI_MODEL,
      status,
      error: error ?? null,
    });
  } catch (e) {
    console.error("logSkill failed", e);
  }
}

async function createAlert(leadId: number, riskType: string, severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL", title: string, description: string, evidence: Record<string, unknown>, recommendedAction: string) {
  await sb.from("ai_risk_alerts").insert({
    lead_id: leadId,
    risk_type: riskType,
    severity,
    title,
    description,
    evidence,
    recommended_action: recommendedAction,
  });
  if (severity === "HIGH" || severity === "CRITICAL") {
    try {
      await sb.rpc("create_notification", {
        p_lead_id: leadId,
        p_recipient_email: null,
        p_recipient_role: "credit",
        p_type: "ai_risk_alert",
        p_title: title,
        p_message: description,
      });
    } catch (e) {
      console.error("risk alert notify failed", e);
    }
  }
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

  const leadId = body?.lead_id;
  if (!leadId) return new Response("Missing lead_id", { status: 400 });

  const { data: lead, error } = await sb.from("leads").select("id, borrower, loan_type, loan_amount, created_at").eq("id", leadId).maybeSingle();
  if (error || !lead) {
    await logSkill(leadId, "FAILED", undefined, "Lead not found");
    return new Response("Lead not found", { status: 200 });
  }

  const flagsRaised: string[] = [];
  const phone = lead.borrower?.phone as string | undefined;

  // --- Check 1: repeated/duplicate applications from the same number ---
  if (phone) {
    const target = last10(phone);
    const cutoff = new Date(Date.now() - DUPLICATE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: others } = await sb
      .from("leads")
      .select("id, loan_type, created_at, borrower")
      .neq("id", leadId)
      .gte("created_at", cutoff)
      .limit(50);

    const matches = (others ?? []).filter((l: any) => last10(l.borrower?.phone) === target);
    if (matches.length > 0) {
      flagsRaised.push("duplicate_applications");
      const severity = matches.length >= 3 ? "HIGH" : "MEDIUM";
      await createAlert(
        leadId, "duplicate_applications", severity,
        "Repeated applications from the same applicant",
        `This phone number has ${matches.length} other application${matches.length > 1 ? "s" : ""} in the last ${DUPLICATE_WINDOW_DAYS} days.`,
        { other_lead_ids: matches.map((m: any) => m.id), other_loan_types: matches.map((m: any) => m.loan_type) },
        "Review whether this is a genuine repeat customer or a duplicate/erroneous submission.",
      );
    }
  }

  // --- Check 2: unusual loan amount for the product ---
  if (typeof lead.loan_amount === "number" && lead.loan_amount > 0) {
    const highBand = UNUSUAL_AMOUNT_HIGH[lead.loan_type ?? ""] ?? 50000000;
    if (lead.loan_amount > highBand) {
      flagsRaised.push("unusual_amount_high");
      await createAlert(
        leadId, "unusual_amount", "LOW",
        "Unusually high loan amount for product type",
        `Requested amount (₹${lead.loan_amount.toLocaleString("en-IN")}) is above the typical range configured for ${lead.loan_type ?? "this product"}.`,
        { loan_amount: lead.loan_amount, loan_type: lead.loan_type, threshold: highBand },
        "Informational — confirm this is a genuine high-value requirement.",
      );
    } else if (lead.loan_amount < UNUSUAL_AMOUNT_LOW) {
      flagsRaised.push("unusual_amount_low");
      await createAlert(
        leadId, "unusual_amount", "LOW",
        "Unusually low loan amount",
        `Requested amount (₹${lead.loan_amount.toLocaleString("en-IN")}) is unusually small — confirm this wasn't a data entry or bot-parsing error.`,
        { loan_amount: lead.loan_amount, loan_type: lead.loan_type },
        "Verify the requested amount with the applicant.",
      );
    }
  }

  // --- Check 3: loan amount vs declared income ---
  // Skipped for Business Loan: the WhatsApp bot stores annual TURNOVER in
  // borrower.income for that product (no monthly-income question exists),
  // so "income x 12" would be meaningless and turnover is not income.
  const income = lead.loan_type === "Business Loan" ? null : toNumber(lead.borrower?.income);
  if (income !== null && income > 0 && typeof lead.loan_amount === "number") {
    const annualIncome = income * 12;
    if (lead.loan_amount > annualIncome * INCOME_MULTIPLE_FLAG) {
      flagsRaised.push("amount_vs_income");
      await createAlert(
        leadId, "amount_vs_income", "MEDIUM",
        "Loan amount high relative to stated income",
        `Requested amount is ${(lead.loan_amount / annualIncome).toFixed(1)}x the applicant's stated annual income — worth verifying before proceeding.`,
        { loan_amount: lead.loan_amount, monthly_income: income, annual_income: annualIncome },
        "Verify income documentation and repayment capacity before proceeding.",
      );
    }
  }

  await logSkill(leadId, "SUCCESS", flagsRaised.length ? `Flags: ${flagsRaised.join(", ")}` : "No risk flags raised");

  return new Response(JSON.stringify({ flags_raised: flagsRaised }), { status: 200, headers: { "Content-Type": "application/json" } });
});
