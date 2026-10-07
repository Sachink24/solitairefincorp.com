// =========================================================
// SOLITAIRE FINZ MART — AI Orchestrator for the WhatsApp bot
//
// Two jobs, used by whatsapp-webhook/index.ts:
//
//  1. INTENT ROUTER — routeMessage(): reads a free-typed message such as
//     "50 lakh home loan chahiye" or "Home loan 5000000 location thane
//     business" and decides what the customer wants:
//       NEW_LOAN  -> which product + any answers already stated in the text
//       STATUS    -> wants an application status
//       HUMAN     -> wants to talk to a person
//       QUESTION  -> asking for information (documents, eligibility, process)
//       COMPANY   -> asking who we are / about the company (fixed short answer)
//       OTHER     -> greeting / unclear (caller falls back to the normal menu)
//
//  2. LOAN ADVISOR — advise(): answers general loan questions, grounded to
//     this business, never promising approval, rates or amounts.
//
// Design rules:
//  - Rules run FIRST and need no network, so product + amount detection keeps
//    working even if Gemini is down or returns 503. Gemini adds language
//    understanding (Hindi / Hinglish), city, name, employment type, etc.
//  - Everything Gemini returns is validated against the product's own
//    question schema (public.whatsapp_products.questions) before use.
//  - This module never touches the database and never sends messages.
//    index.ts stays the single place that writes leads and talks to Meta.
// =========================================================

export type Intent = "NEW_LOAN" | "STATUS" | "HUMAN" | "QUESTION" | "COMPANY" | "OTHER";

export interface OrchestratorDeps {
  // callGemini() from index.ts; null when GEMINI_API_KEY is not configured.
  ask: ((system: string, user: string, jsonMode?: boolean, maxTokens?: number) => Promise<string | null>) | null;
  // COMPANY_CONTEXT from index.ts (business description + safety rules).
  companyContext: string;
}

export interface RouteResult {
  intent: Intent;
  product: any | null;
  answers: Record<string, unknown>;
  source: "ai" | "rules" | "none";
}

// ---------------------------------------------------------
// Company introduction — fixed text (not AI-generated) so it is always
// accurate. Edit here to change what customers see.
// ---------------------------------------------------------
export const COMPANY_ABOUT =
  "*SOLITAIRE FINZ MART* is a loan and financial advisory firm in Bhiwandi, Thane (Maharashtra) with 15+ years of experience.\n\n" +
  "We help individuals and businesses with Home Loans, Loan Against Property, Business & Personal Loans, Vehicle Finance, Balance Transfer & Top-up and Project Finance \u2014 working with leading banks and NBFCs like ICICI, Axis, SBI, HDFC, PNB, Tata Capital, Piramal and IIFL.\n\n" +
  "Approval, rates and loan amounts are decided by the lending partner.";

const COMPANY_RE = /\b(about (?:your |the |this )?(?:company|firm|business|solitaire(?: finz mart)?|us)|who are you|who r u|tell me about (?:your |the |this )?(?:company|firm|solitaire(?: finz mart)?|yourself|you)|what (?:do|does) (?:you|your company|solitaire(?: finz mart)?) do|company (?:profile|details|info|information)|introduce (?:yourself|your company)|aap kaun|aapki company|company ke (?:bare|baare)|solitaire (?:finz mart )?kya)\b/i;

export function isCompanyQuestion(text: string): boolean {
  return COMPANY_RE.test(text);
}

// ---------------------------------------------------------
// Keyword rules (English / Hindi / Hinglish)
// ---------------------------------------------------------
const PRODUCT_PATTERNS: Record<string, RegExp[]> = {
  loan_against_property: [/loan against property/i, /against property/i, /\blap\b/i, /mortgage/i, /property (?:par|pe|ke upar|ke against)/i],
  balance_transfer_topup: [/balance transfer/i, /top[\s-]?up/i, /\bbt\b/i, /loan transfer/i, /take[\s-]?over/i],
  project_finance: [/project finance/i, /construction finance/i, /builder (?:loan|finance)/i, /developer (?:loan|finance)/i, /project (?:loan|funding)/i],
  vehicle_loan: [/vehicle/i, /car loan/i, /auto loan/i, /\btruck\b/i, /\btaxi\b/i, /two[\s-]?wheeler/i, /bike loan/i, /\blcv\b/i, /\bgaadi\b/i, /\bgadi\b/i],
  business_loan: [/business loan/i, /working capital/i, /\bmudra\b/i, /\bmsme\b/i, /overdraft/i, /\bod limit\b/i, /\bcc limit\b/i, /vyapar|vyapaar|dhandha/i],
  personal_loan: [/personal loan/i, /\bpl\b/i, /marriage loan/i, /\bshaadi\b|\bshadi\b/i, /medical loan/i, /instant loan/i],
  home_loan: [/home loan/i, /housing loan/i, /house loan/i, /\bghar\b/i, /\bflat\b/i, /apartment/i, /home finance/i],
};

const GREETING_RE = /^(hi+|hello+|hey+|hlo|helo|namaste|namaskar|good (morning|afternoon|evening)|ok(ay)?|thanks?|thank you|thx|yes|no)[\s!.]*$/i;
const STATUS_RE = /\b(status|track(ing)?)\b|(application|file|case)\s+(ka\s+)?(update|status)/i;
const QUESTION_START_RE = /^(what|how|why|can|could|should|does|do|is|are|will|when|where|which|who|kya|kaise|kitna|kitne|kab|kaun|kyun)\b/i;
const QUESTION_WORDS_RE = /\b(documents?|eligibility|eligible|interest rate|rate of interest|roi|process|required|requirement|lagta|lagte|kaise|kitna|kitne|charges|fees|tenure|emi)\b/i;

export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.endsWith("?")) return true;
  if (QUESTION_START_RE.test(t)) return true;
  return QUESTION_WORDS_RE.test(t);
}

// Finds rupee amounts in free text: "50 lakh", "2.5 cr", "50L", "5000000".
// Plain numbers only count if they have 5-9 digits (so ages, years, months and
// 10-digit phone numbers are ignored). Anything followed by % is ignored.
export function extractAmounts(text: string): number[] {
  const out: number[] = [];
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(crores?|cr|lakhs?|lacs?|l|k|thousand|hazaa?r)?(?![a-z0-9])/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const nextChar = text[m.index + m[0].length] ?? "";
    if (nextChar === "%") continue;
    const rawNum = m[1].replace(/,/g, "");
    const n = parseFloat(rawNum);
    if (!isFinite(n) || n <= 0) continue;
    const unit = (m[2] ?? "").toLowerCase();
    let value: number;
    if (unit) {
      if (/^cr/.test(unit)) value = n * 10000000;
      else if (/^(l$|lac|lakh)/.test(unit)) value = n * 100000;
      else value = n * 1000;
      value = Math.round(value);
      if (value < 10000) continue;
    } else {
      const digits = rawNum.split(".")[0].length;
      if (digits < 5 || digits > 9) continue;
      value = Math.round(n);
    }
    out.push(value);
  }
  return out;
}

function findProductByRules(text: string, products: any[]): any | null {
  const lower = text.toLowerCase();
  let best: { product: any; score: number } | null = null;
  for (const p of products) {
    let score = 0;
    const patterns = PRODUCT_PATTERNS[p.key] ?? [];
    for (const re of patterns) {
      const m = lower.match(re);
      if (m && m[0].length > score) score = m[0].length;
    }
    const label = String(p.label ?? "").toLowerCase();
    if (label && lower.includes(label) && label.length > score) score = label.length;
    if (score > 0 && (!best || score > best.score)) best = { product: p, score };
  }
  return best ? best.product : null;
}

// ---------------------------------------------------------
// Answer validation — only values that fit the product's own question
// schema survive (list values must match an option, numbers must be sane).
// ---------------------------------------------------------
function parseLooseAmount(v: unknown): number | null {
  if (typeof v === "number") return isFinite(v) ? Math.round(v) : null;
  if (typeof v !== "string") return null;
  const amounts = extractAmounts(v);
  if (amounts.length === 1) return amounts[0];
  const plain = v.replace(/,/g, "").trim();
  if (/^\d+(\.\d+)?$/.test(plain)) return Math.round(parseFloat(plain));
  return null;
}

export function validateAnswers(product: any, raw: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const q of (product.questions ?? []) as any[]) {
    const v = (raw as Record<string, unknown>)[q.key];
    if (v === undefined || v === null || v === "") continue;
    if (q.type === "list") {
      const s = String(v).trim().toLowerCase();
      const opts = (q.options ?? []) as string[];
      const exact = opts.find((o) => o.toLowerCase() === s);
      const loose = s.length >= 4 ? opts.find((o) => o.toLowerCase().startsWith(s)) : undefined;
      const hit = exact ?? loose;
      if (hit) out[q.key] = hit;
    } else if (q.type === "number") {
      const n = parseLooseAmount(v);
      if (n !== null && n >= 0 && n < 100000000000) out[q.key] = n;
    } else {
      const s = String(v).trim();
      if (!s) continue;
      if (q.key === "full_name") {
        if (s.length >= 3 && s.length <= 80 && /[a-zA-Z]/.test(s)) out[q.key] = s;
      } else if (s.length <= 60) {
        out[q.key] = s;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------
// Intent Router
// ---------------------------------------------------------
function buildClassifierPrompt(products: any[]): string {
  const schema = products.map((p) => ({
    product_key: p.key,
    label: p.label,
    questions: (p.questions ?? []).map((q: any) => ({ key: q.key, type: q.type, options: q.options ?? undefined })),
  }));
  return `You classify one WhatsApp message from a customer of SOLITAIRE FINZ MART, a loan advisory and DSA business in India. Customers write English, Hindi or Hinglish.

Respond with ONLY a JSON object, no explanation, in this exact shape:
{"intent": "NEW_LOAN" | "STATUS" | "HUMAN" | "QUESTION" | "COMPANY" | "OTHER", "product_key": string | null, "answers": object, "confidence": number between 0 and 1}

Meaning of intent:
- NEW_LOAN: the customer wants a loan or states a loan requirement.
- STATUS: the customer asks about the status or progress of an existing application.
- HUMAN: the customer wants to speak to a person.
- COMPANY: the customer asks who we are or what the company does.
- QUESTION: the customer asks for information (documents, eligibility, process, charges) without asking to apply.
- OTHER: greeting, thanks or anything unclear.

"product_key" must be one of the keys below, or null.
"answers" maps a question "key" of the chosen product to a value the message CLEARLY states. Omit anything you are not sure about. Never guess a name or city.
- "list" fields: the value MUST exactly match one of that question's options.
- "number" fields: plain rupees as a number. Convert lakh/lac to x100000, crore/cr to x10000000, k to x1000.

Products and their questions:
${JSON.stringify(schema)}`;
}

async function aiClassify(text: string, products: any[], deps: OrchestratorDeps): Promise<{ intent: Intent; product_key: string | null; answers: Record<string, unknown>; confidence: number } | null> {
  if (!deps.ask) return null;
  const raw = await deps.ask(buildClassifierPrompt(products), text, true, 800);
  if (!raw) return null;
  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const p = JSON.parse(cleaned);
    const intent = String(p?.intent ?? "").toUpperCase() as Intent;
    if (!["NEW_LOAN", "STATUS", "HUMAN", "QUESTION", "COMPANY", "OTHER"].includes(intent)) return null;
    const key = typeof p.product_key === "string" ? p.product_key : null;
    const conf = typeof p.confidence === "number" ? p.confidence : 0.7;
    const answers = p.answers && typeof p.answers === "object" ? p.answers : {};
    return { intent, product_key: key, answers, confidence: conf };
  } catch {
    return null;
  }
}

export async function routeMessage(text: string, products: any[], deps: OrchestratorDeps): Promise<RouteResult> {
  const none: RouteResult = { intent: "OTHER", product: null, answers: {}, source: "none" };
  const t = text.trim();
  if (!t || GREETING_RE.test(t)) return none;
  if (COMPANY_RE.test(t)) return { intent: "COMPANY", product: null, answers: {}, source: "rules" };

  const ruleProduct = findProductByRules(t, products);
  const amounts = extractAmounts(t);
  const isQuestion = looksLikeQuestion(t);
  const isStatus = STATUS_RE.test(t);

  const ai = await aiClassify(t, products, deps);
  const aiUsable = ai !== null && ai.confidence >= 0.5;

  let intent: Intent;
  let product: any | null = null;
  let source: "ai" | "rules" = "rules";

  if (aiUsable) {
    source = "ai";
    intent = ai!.intent;
    const aiProduct = ai!.product_key ? products.find((p) => p.key === ai!.product_key) ?? null : null;
    product = aiProduct ?? ruleProduct;
    if (intent === "NEW_LOAN" && !product) intent = "OTHER";
  } else {
    product = ruleProduct;
    if (isStatus) intent = "STATUS";
    else if (product && !(isQuestion && amounts.length === 0)) intent = "NEW_LOAN";
    else if (isQuestion) intent = "QUESTION";
    else intent = "OTHER";
  }

  let answers: Record<string, unknown> = {};
  if (intent === "NEW_LOAN" && product) {
    answers = validateAnswers(product, aiUsable ? ai!.answers : {});
    // Rules fallback for the amount: exactly one amount in the text, and not
    // for Balance Transfer (where loan_amount means the top-up, not the loan).
    const hasLoanAmountQ = (product.questions ?? []).some((q: any) => q.key === "loan_amount");
    if (hasLoanAmountQ && answers.loan_amount === undefined && amounts.length === 1 && product.key !== "balance_transfer_topup") {
      answers.loan_amount = amounts[0];
    }
  }

  return { intent, product, answers, source };
}

// A short, readable summary of what was captured from the first message.
const SUMMARY_LABELS: Record<string, string> = {
  loan_amount: "Loan amount",
  city: "City",
  project_location: "Location",
  customer_type: "Profile",
  property_value: "Property value",
  monthly_income: "Monthly income",
  annual_turnover: "Annual turnover",
  full_name: "Name",
  requirement_type: "Requirement",
};

export function summarizeCaptured(answers: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(answers)) {
    const label = SUMMARY_LABELS[k];
    if (!label) continue;
    const shown = typeof v === "number" ? `Rs. ${v.toLocaleString("en-IN")}` : String(v);
    lines.push(`• ${label}: ${shown}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------
// Loan Advisor
// ---------------------------------------------------------
export async function advise(text: string, products: any[], deps: OrchestratorDeps): Promise<string | null> {
  if (!deps.ask) return null;
  const labels = products.map((p) => p.label).join(", ");
  const system = `${deps.companyContext}

Products offered through the WhatsApp assistant: ${labels}.
Reply in the same language and script the customer used (English, Hindi or Hinglish).
Do not ask for personal or financial details in your answer. If the customer seems ready to apply, tell them they can tap "Apply for Loan" below.`;
  const answer = await deps.ask(system, text, false, 700);
  return answer ? answer.trim() : null;
}
