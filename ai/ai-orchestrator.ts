// SOLITAIRE Finz Mart — Stage 1 AI Orchestrator
// Connects intent routing to the existing deterministic WhatsApp state machine.

import { routeIntent, type AiIntentResult } from "./intent-router.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash";

export async function detectIntent(userText: string, products: any[]): Promise<AiIntentResult | null> {
  const productSummary = products.map((p: any) => ({
    key: p.key,
    label: p.label,
    loan_type: p.loan_type,
  }));
  return routeIntent(GEMINI_API_KEY, GEMINI_MODEL, userText, productSummary);
}

function normalize(s: string) {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function aliasesForIntent(intent: string): string[] {
  const map: Record<string, string[]> = {
    HOME_LOAN: ["home loan", "housing loan", "house loan"],
    BUSINESS_LOAN: ["business loan", "msme loan", "commercial loan"],
    PERSONAL_LOAN: ["personal loan"],
    LAP_MORTGAGE: ["lap", "mortgage", "loan against property"],
    CONSTRUCTION_FINANCE: ["construction finance", "construction loan"],
    NRI_HOME_LOAN: ["nri home loan", "nri loan"],
    LOAN_CONSOLIDATION: ["loan consolidation", "debt consolidation"],
  };
  return map[intent] ?? [];
}

export function findProductForIntent(intent: string, products: any[], hint?: string | null): any | null {
  const haystack = normalize(`${hint ?? ""} ${aliasesForIntent(intent).join(" ")}`);
  let best: any = null;
  let bestScore = 0;

  for (const p of products) {
    const text = normalize(`${p.key ?? ""} ${p.label ?? ""} ${p.loan_type ?? ""}`);
    let score = 0;
    if (haystack && text && haystack.includes(text)) score += 3;
    for (const alias of aliasesForIntent(intent)) {
      if (text.includes(normalize(alias))) score += 4;
    }
    if (hint && normalize(hint) && text.includes(normalize(hint))) score += 5;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

export function seedAnswersFromIntent(product: any, result: AiIntentResult): Record<string, any> {
  const seeded: Record<string, any> = {};
  if (!product?.questions) return seeded;

  for (const q of product.questions as any[]) {
    const key = normalize(q?.key ?? "");
    if (result.loan_amount && ["loan amount", "loan_amount", "amount", "required amount", "required_loan_amount"].some(a => key === normalize(a) || key.includes(normalize(a)))) {
      seeded[q.key] = result.loan_amount;
    }
  }
  return seeded;
}

export function firstMissingQuestionIndex(product: any, answers: Record<string, any>): number {
  const questions = Array.isArray(product?.questions) ? product.questions : [];
  for (let i = 0; i < questions.length; i++) {
    const key = questions[i]?.key;
    if (!key || answers?.[key] === undefined || answers?.[key] === null || answers?.[key] === "") return i;
  }
  return questions.length;
}
