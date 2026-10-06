// SOLITAIRE Finz Mart — Stage 1 AI Intent Router
// Uses Gemini structured JSON output. Never makes approval/sanction decisions.

export type AiIntent =
  | "HOME_LOAN"
  | "BUSINESS_LOAN"
  | "PERSONAL_LOAN"
  | "LAP_MORTGAGE"
  | "CONSTRUCTION_FINANCE"
  | "NRI_HOME_LOAN"
  | "LOAN_CONSOLIDATION"
  | "EMI_QUERY"
  | "ELIGIBILITY_QUERY"
  | "APPLICATION_STATUS"
  | "DOCUMENT_QUERY"
  | "HUMAN_AGENT"
  | "GENERAL_LOAN_QUERY"
  | "OTHER";

export interface AiIntentResult {
  intent: AiIntent;
  confidence: number;
  loan_amount: number | null;
  language: "en" | "hi" | "hinglish" | "other";
  product_hint: string | null;
  wants_human: boolean;
}

const INTENTS: AiIntent[] = [
  "HOME_LOAN", "BUSINESS_LOAN", "PERSONAL_LOAN", "LAP_MORTGAGE",
  "CONSTRUCTION_FINANCE", "NRI_HOME_LOAN", "LOAN_CONSOLIDATION",
  "EMI_QUERY", "ELIGIBILITY_QUERY", "APPLICATION_STATUS", "DOCUMENT_QUERY",
  "HUMAN_AGENT", "GENERAL_LOAN_QUERY", "OTHER",
];

function cleanResult(raw: any): AiIntentResult {
  const intent = INTENTS.includes(raw?.intent) ? raw.intent : "OTHER";
  const confidence = Math.max(0, Math.min(1, Number(raw?.confidence ?? 0)));
  const amount = raw?.loan_amount === null || raw?.loan_amount === undefined
    ? null
    : Number(raw.loan_amount);

  return {
    intent,
    confidence: Number.isFinite(confidence) ? confidence : 0,
    loan_amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    language: ["en", "hi", "hinglish", "other"].includes(raw?.language) ? raw.language : "en",
    product_hint: typeof raw?.product_hint === "string" ? raw.product_hint.slice(0, 100) : null,
    wants_human: Boolean(raw?.wants_human),
  };
}

export async function routeIntent(
  apiKey: string,
  model: string,
  userText: string,
  productSummary: any[],
): Promise<AiIntentResult | null> {
  if (!apiKey || !userText.trim()) return null;

  const prompt = `Classify this WhatsApp customer message for SOLITAIRE Finz Mart.

Available products from the database:
${JSON.stringify(productSummary)}

Customer message:
${userText}

Rules:
- Identify the customer's main intent.
- loan_amount must be a numeric INR amount if clearly stated. Convert 50 lakh to 5000000 and 1.2 crore to 12000000.
- Do not invent an amount.
- confidence is 0 to 1.
- If the customer asks for a person/expert/agent, use HUMAN_AGENT and wants_human=true.
- APPLICATION_STATUS means checking an existing application/loan status.
- EMI_QUERY means EMI/calculation only.
- ELIGIBILITY_QUERY means whether they qualify.
- GENERAL_LOAN_QUERY is a broad financing question without a clear product.
- Keep product_hint short and based only on the customer's message.
`;

  const schema = {
    type: "OBJECT",
    properties: {
      intent: { type: "STRING", enum: INTENTS },
      confidence: { type: "NUMBER", minimum: 0, maximum: 1 },
      loan_amount: { type: ["NUMBER", "NULL"] },
      language: { type: "STRING", enum: ["en", "hi", "hinglish", "other"] },
      product_hint: { type: ["STRING", "NULL"] },
      wants_human: { type: "BOOLEAN" },
    },
    required: ["intent", "confidence", "loan_amount", "language", "product_hint", "wants_human"],
  };

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: "You are a strict intent classifier. Return only schema-compliant JSON. Never make lending decisions." }],
          },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 300,
            responseMimeType: "application/json",
            responseSchema: schema,
          },
        }),
      },
    );

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("Gemini intent router failed", res.status, JSON.stringify(json));
      return null;
    }

    const rawText = json?.candidates?.[0]?.content?.parts
      ?.map((p: any) => p?.text ?? "")
      .join("")
      .trim();
    if (!rawText) return null;

    const parsed = JSON.parse(rawText);
    return cleanResult(parsed);
  } catch (err) {
    console.error("Gemini intent router error", err);
    return null;
  }
}
