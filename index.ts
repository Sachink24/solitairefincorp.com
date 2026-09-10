// =========================================================
// SOLITAIRE FINZ MART — WhatsApp Cloud API webhook + bot engine
// Deployed as a Supabase Edge Function. Handles:
//  - Meta webhook verification (GET)
//  - Incoming message processing (POST)
//  - New-vs-existing customer detection
//  - Configurable product/question flow (public.whatsapp_products)
//  - Lead creation directly into public.leads (starts the real
//    legal/technical/credit underwriting workflow)
//  - Configurable BA assignment (public.whatsapp_assignment_rules,
//    falling back to round-robin across active business_associates)
//  - Human agent handover
//  - Existing-customer application status lookup
//
// Auth: verify_jwt is OFF for this function (Meta cannot send a Supabase
// JWT). Instead we verify Meta's own signature (X-Hub-Signature-256) and
// the GET verify_token — see verifyMetaSignature() / handleVerify().
// =========================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN")!;
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")!;
const WHATSAPP_VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN")!;
const META_APP_SECRET = Deno.env.get("META_APP_SECRET")!;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const GRAPH_URL = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

// ---------------------------------------------------------
// Meta signature verification (webhook security — spec section 24/26)
// ---------------------------------------------------------
async function verifyMetaSignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expectedHex = signatureHeader.slice("sha256=".length);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(META_APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computedHex = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
  if (computedHex.length !== expectedHex.length) return false;
  // constant-time compare
  let diff = 0;
  for (let i = 0; i < computedHex.length; i++) diff |= computedHex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------
// WhatsApp send helpers
// ---------------------------------------------------------
async function waSend(body: Record<string, unknown>) {
  const res = await fetch(GRAPH_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("WhatsApp send failed", res.status, JSON.stringify(json));
  }
  return json;
}

async function sendText(to: string, text: string) {
  return waSend({ to, type: "text", text: { body: text, preview_url: false } });
}

// WhatsApp interactive buttons: max 3 options, 20 chars each.
async function sendButtons(to: string, bodyText: string, options: string[]) {
  return waSend({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: {
        buttons: options.slice(0, 3).map((label, i) => ({
          type: "reply",
          reply: { id: `opt_${i}`, title: label.slice(0, 20) },
        })),
      },
    },
  });
}

// WhatsApp interactive list: up to 10 rows, used for menus with >3 options.
async function sendList(to: string, bodyText: string, buttonLabel: string, options: string[]) {
  return waSend({
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: bodyText },
      action: {
        button: buttonLabel.slice(0, 20),
        sections: [{
          title: "Options",
          rows: options.slice(0, 10).map((label, i) => ({
            id: `opt_${i}`,
            title: label.slice(0, 24),
          })),
        }],
      },
    },
  });
}

// Picks list vs buttons automatically based on option count.
async function sendOptions(to: string, bodyText: string, options: string[], listButtonLabel = "Choose") {
  if (options.length <= 3) return sendButtons(to, bodyText, options);
  return sendList(to, bodyText, listButtonLabel, options);
}

// ---------------------------------------------------------
// Utilities
// ---------------------------------------------------------
function normalizePhone(raw: string): string {
  // Meta sends numbers without '+', e.g. "918779023084". Keep digits only.
  return raw.replace(/[^\d]/g, "");
}

function parseAmount(text: string): number | null {
  const cleaned = text.toLowerCase().replace(/,/g, "").trim();
  const lakhMatch = cleaned.match(/^([\d.]+)\s*(lakh|lac|l)$/);
  if (lakhMatch) return Math.round(parseFloat(lakhMatch[1]) * 100000);
  const croreMatch = cleaned.match(/^([\d.]+)\s*(crore|cr)$/);
  if (croreMatch) return Math.round(parseFloat(croreMatch[1]) * 10000000);
  const plain = cleaned.match(/^[\d.]+$/);
  if (plain) return Math.round(parseFloat(cleaned));
  return null;
}

function isValidName(text: string): boolean {
  return text.trim().length >= 3 && /[a-zA-Z]/.test(text);
}

const RESET_WORDS = ["main menu", "menu", "restart", "start over"];
const AGENT_WORDS = ["talk to agent", "talk to expert", "talk to loan expert", "agent", "human", "relationship manager"];

// Extracts the text a user "said", whether typed or tapped, plus the raw
// button/list id if this was an interactive reply (so we can match by
// position instead of re-parsing label text).
function extractReply(message: any): { text: string; optionIndex: number | null } {
  if (message.type === "interactive") {
    const inter = message.interactive;
    if (inter?.button_reply) {
      const idx = parseInt(inter.button_reply.id.replace("opt_", ""), 10);
      return { text: inter.button_reply.title, optionIndex: isNaN(idx) ? null : idx };
    }
    if (inter?.list_reply) {
      const idx = parseInt(inter.list_reply.id.replace("opt_", ""), 10);
      return { text: inter.list_reply.title, optionIndex: isNaN(idx) ? null : idx };
    }
  }
  if (message.type === "text") {
    return { text: message.text?.body ?? "", optionIndex: null };
  }
  return { text: "", optionIndex: null };
}

// ---------------------------------------------------------
// Conversation persistence
// ---------------------------------------------------------
async function getOrCreateConversation(waNumber: string) {
  const { data: existing } = await sb.from("whatsapp_conversations").select("*").eq("wa_number", waNumber).maybeSingle();
  if (existing) return { conversation: existing, isNew: false };

  // New-vs-existing customer detection (spec section 14): match against
  // prior leads by phone number stored in leads.borrower->>'phone'.
  const { data: priorLeads } = await sb
    .from("leads")
    .select("id, loan_type, stage, status, created_at, borrower")
    .eq("borrower->>phone", waNumber)
    .order("created_at", { ascending: false })
    .limit(5);

  const isExisting = !!(priorLeads && priorLeads.length > 0);
  const displayName = isExisting ? (priorLeads![0].borrower?.name ?? null) : null;

  const { data: created, error } = await sb.from("whatsapp_conversations").insert({
    wa_number: waNumber,
    display_name: displayName,
    is_existing_customer: isExisting,
    matched_lead_id: isExisting ? priorLeads![0].id : null,
    state: "MAIN_MENU",
  }).select("*").single();

  if (error) throw error;
  return { conversation: created, isNew: true };
}

async function updateConversation(id: string, patch: Record<string, unknown>) {
  await sb.from("whatsapp_conversations").update({ ...patch, updated_at: new Date().toISOString(), last_message_at: new Date().toISOString() }).eq("id", id);
}

async function logMessage(conversationId: string, direction: "inbound" | "outbound", body: string, waMessageId: string | null = null, messageType = "text", payload: unknown = null) {
  await sb.from("whatsapp_messages").insert({
    conversation_id: conversationId,
    direction,
    wa_message_id: waMessageId,
    message_type: messageType,
    body,
    payload,
  });
}

async function getActiveProducts() {
  const { data } = await sb.from("whatsapp_products").select("*").eq("active", true).order("display_order");
  return data ?? [];
}

// ---------------------------------------------------------
// BA assignment (spec section 19) — configurable rules first,
// falling back to round-robin across active business_associates.
// ---------------------------------------------------------
async function pickAssignedBA(productKey: string, city: string | null): Promise<string | null> {
  const { data: rules } = await sb
    .from("whatsapp_assignment_rules")
    .select("*")
    .eq("active", true)
    .or(`product_key.eq.${productKey},product_key.is.null`)
    .order("priority", { ascending: false });

  if (rules && rules.length) {
    const cityMatch = city ? rules.find(r => r.city && r.city.toLowerCase() === city.toLowerCase()) : null;
    const productMatch = rules.find(r => r.product_key === productKey && !r.city);
    const anyMatch = rules.find(r => !r.product_key && !r.city);
    const picked = cityMatch ?? productMatch ?? anyMatch;
    if (picked) return picked.ba_email;
  }

  // Fallback: round-robin across active BAs, based on how many leads
  // each currently holds (simple load-balancing, not strict rotation).
  const { data: bas } = await sb.from("business_associates").select("email").eq("status", "active");
  if (!bas || !bas.length) return null;
  const counts = await Promise.all(bas.map(async (ba) => {
    const { count } = await sb.from("leads").select("id", { count: "exact", head: true }).eq("assigned_ba", ba.email);
    return { email: ba.email, count: count ?? 0 };
  }));
  counts.sort((a, b) => a.count - b.count);
  return counts[0]?.email ?? null;
}

// ---------------------------------------------------------
// Lead creation — writes directly into public.leads, matching the
// existing borrower jsonb shape (name/phone/location/income/employment),
// and logs to workflow_history the same way staff-driven actions do.
// ---------------------------------------------------------
async function createLeadFromConversation(conv: any, product: any) {
  const answers = conv.answers ?? {};
  const assignedBa = await pickAssignedBA(product.key, answers.city ?? answers.project_location ?? null);

  const borrower: Record<string, unknown> = {
    name: answers.full_name ?? null,
    phone: conv.wa_number,
    location: answers.city ?? answers.project_location ?? null,
    income: answers.monthly_income ?? answers.annual_turnover ?? null,
    employment: answers.customer_type ?? null,
  };

  const { data: lead, error } = await sb.from("leads").insert({
    borrower,
    loan_type: product.loan_type,
    loan_amount: answers.loan_amount ?? answers.total_project_cost ?? null,
    assigned_ba: assignedBa,
    stage: "New",
    status: "NEW",
    created_by: "WhatsApp Bot",
  }).select("id").single();

  if (error) {
    console.error("Lead creation failed", error);
    return null;
  }

  await sb.from("workflow_history").insert({
    lead_id: lead.id,
    action: "Lead created via WhatsApp",
    new_status: "NEW",
    user_name: "WhatsApp Bot",
    role: "system",
    remarks: `Product: ${product.label}. Assigned BA: ${assignedBa ?? "unassigned"}. Captured via automated WhatsApp conversation.`,
  });

  return { leadId: lead.id as number, assignedBa };
}

// ---------------------------------------------------------
// Main conversation state machine
// ---------------------------------------------------------
async function handleIncomingMessage(waNumber: string, message: any) {
  const { conversation, isNew } = await getOrCreateConversation(waNumber);
  const { text, optionIndex } = extractReply(message);
  await logMessage(conversation.id, "inbound", text, message.id, message.type, message);

  const lower = text.trim().toLowerCase();

  // Global commands, available from any state.
  if (RESET_WORDS.includes(lower)) {
    await updateConversation(conversation.id, { state: "MAIN_MENU", product_key: null, question_index: 0, answers: {}, handed_to_agent: false });
    return sendMainMenu(waNumber, conversation);
  }
  if (AGENT_WORDS.some(w => lower.includes(w))) {
    return handOverToAgent(waNumber, conversation);
  }
  if (conversation.handed_to_agent) {
    // Bot stays silent while a human agent owns the conversation; staff
    // reply from the Admin Panel / their own WhatsApp, not through here.
    return;
  }

  if (isNew) return sendWelcome(waNumber, conversation);

  switch (conversation.state) {
    case "MAIN_MENU":
      return handleMainMenuReply(waNumber, conversation, optionIndex, text);
    case "PRODUCT_SELECT":
      return handleProductSelectReply(waNumber, conversation, optionIndex, text);
    case "ASKING_QUESTION":
      return handleQuestionReply(waNumber, conversation, text, optionIndex);
    case "STATUS_SELECT":
      return handleStatusSelectReply(waNumber, conversation, optionIndex);
    default:
      await updateConversation(conversation.id, { state: "MAIN_MENU" });
      return sendMainMenu(waNumber, conversation);
  }
}

async function sendWelcome(waNumber: string, conv: any) {
  if (conv.is_existing_customer) {
    const name = conv.display_name ?? "there";
    await sendText(waNumber, `Welcome back to Solitaire Finz Mart, ${name}! 👋\n\nHow can I help you today?`);
  } else {
    await sendText(waNumber, "Welcome to Solitaire Finz Mart! 👋\n\nWe help customers explore suitable loan and financing options.\n\nHow may I help you today?");
  }
  await updateConversation(conv.id, { state: "MAIN_MENU" });
  return sendMainMenu(waNumber, conv);
}

function mainMenuOptions(conv: any): string[] {
  return conv.is_existing_customer
    ? ["Check Application Status", "Existing Loan Query", "New Loan Requirement", "Submit Documents", "Talk to Relationship Manager"]
    : ["New Loan Requirement", "Talk to Loan Expert", "Other Query"];
}

async function sendMainMenu(waNumber: string, conv: any) {
  const options = mainMenuOptions(conv);
  const msg = await sendOptions(waNumber, "Please choose an option:", options, "Menu");
  await logMessage(conv.id, "outbound", "[main menu]", msg?.messages?.[0]?.id, "interactive");
}

async function handleMainMenuReply(waNumber: string, conv: any, optionIndex: number | null, text: string) {
  const options = mainMenuOptions(conv);
  const choice = optionIndex !== null ? options[optionIndex] : options.find(o => o.toLowerCase() === text.trim().toLowerCase());

  if (!choice) {
    await sendText(waNumber, "I didn't quite understand that. Please select one of the options below.");
    return sendMainMenu(waNumber, conv);
  }

  if (choice === "New Loan Requirement") {
    await updateConversation(conv.id, { state: "PRODUCT_SELECT" });
    return sendProductMenu(waNumber, conv.id);
  }
  if (choice === "Check Application Status") {
    return sendApplicationStatus(waNumber, conv);
  }
  if (choice === "Talk to Loan Expert" || choice === "Talk to Relationship Manager") {
    return handOverToAgent(waNumber, conv);
  }
  if (choice === "Submit Documents") {
    await sendText(waNumber, "Please share the documents here as photos or PDFs, along with your name and loan reference (if known). Our team will pick them up and confirm receipt.");
    return handOverToAgent(waNumber, conv, /*silent*/ true);
  }
  // "Existing Loan Query" / "Other Query" — route to a human, since these
  // are open-ended and the bot shouldn't guess.
  return handOverToAgent(waNumber, conv);
}

async function sendProductMenu(waNumber: string, conversationId: string) {
  const products = await getActiveProducts();
  const labels = products.map((p) => p.label);
  const msg = await sendOptions(waNumber, "Which loan product are you interested in?", labels.length ? [...labels, "Other Loan Requirement"] : ["Other Loan Requirement"], "Products");
  await logMessage(conversationId, "outbound", "[product menu]", msg?.messages?.[0]?.id, "interactive");
}

async function handleProductSelectReply(waNumber: string, conv: any, optionIndex: number | null, text: string) {
  const products = await getActiveProducts();
  const labels = [...products.map((p) => p.label), "Other Loan Requirement"];
  const choiceLabel = optionIndex !== null ? labels[optionIndex] : labels.find(l => l.toLowerCase() === text.trim().toLowerCase());

  if (!choiceLabel) {
    await sendText(waNumber, "I didn't quite understand that. Please select one of the options below.");
    return sendProductMenu(waNumber, conv.id);
  }

  if (choiceLabel === "Other Loan Requirement") {
    await sendText(waNumber, "No problem — one of our loan experts will get in touch to understand your requirement.");
    return handOverToAgent(waNumber, conv);
  }

  const product = products.find((p) => p.label === choiceLabel);
  if (!product) {
    await sendText(waNumber, "That option isn't available right now. Please choose from the list below.");
    return sendProductMenu(waNumber, conv.id);
  }

  await updateConversation(conv.id, { state: "ASKING_QUESTION", product_key: product.key, question_index: 0, answers: {} });
  return askQuestion(waNumber, { ...conv, product_key: product.key, question_index: 0 }, product, 0);
}

async function askQuestion(waNumber: string, conv: any, product: any, index: number) {
  const questions = product.questions as any[];
  const q = questions[index];
  if (q.type === "list") {
    const msg = await sendOptions(waNumber, q.label, q.options, "Select");
    await logMessage(conv.id, "outbound", q.label, msg?.messages?.[0]?.id, "interactive");
  } else {
    const msg = await sendText(waNumber, q.label);
    await logMessage(conv.id, "outbound", q.label, msg?.messages?.[0]?.id, "text");
  }
}

async function handleQuestionReply(waNumber: string, conv: any, text: string, optionIndex: number | null) {
  if (lowerIsBack(text)) {
    const prevIndex = Math.max(0, conv.question_index - 1);
    await updateConversation(conv.id, { question_index: prevIndex });
    const products = await getActiveProducts();
    const product = products.find((p) => p.key === conv.product_key);
    if (product) return askQuestion(waNumber, conv, product, prevIndex);
  }

  const products = await getActiveProducts();
  const product = products.find((p) => p.key === conv.product_key);
  if (!product) {
    await updateConversation(conv.id, { state: "MAIN_MENU" });
    return sendMainMenu(waNumber, conv);
  }

  const questions = product.questions as any[];
  const q = questions[conv.question_index];
  let value: string | number | null = null;

  if (q.type === "list") {
    value = optionIndex !== null ? q.options[optionIndex] : q.options.find((o: string) => o.toLowerCase() === text.trim().toLowerCase());
    if (!value) {
      await sendText(waNumber, "I didn't quite understand that. Please select one of the options below.");
      return askQuestion(waNumber, conv, product, conv.question_index);
    }
  } else if (q.type === "number") {
    value = parseAmount(text);
    if (value === null) {
      await sendText(waNumber, "Please enter a valid amount (numbers only, e.g. 2500000 or 25 lakh).");
      return askQuestion(waNumber, conv, product, conv.question_index);
    }
  } else {
    // text — apply light validation for the name field specifically
    if (q.key === "full_name" && !isValidName(text)) {
      await sendText(waNumber, "Please enter your full name (at least 3 letters).");
      return askQuestion(waNumber, conv, product, conv.question_index);
    }
    value = text.trim();
  }

  const updatedAnswers = { ...conv.answers, [q.key]: value };
  const nextIndex = conv.question_index + 1;

  if (nextIndex >= questions.length) {
    await updateConversation(conv.id, { answers: updatedAnswers, state: "COMPLETED" });
    return finalizeLead(waNumber, { ...conv, answers: updatedAnswers }, product);
  }

  await updateConversation(conv.id, { answers: updatedAnswers, question_index: nextIndex });
  return askQuestion(waNumber, conv, product, nextIndex);
}

function lowerIsBack(text: string) {
  return text.trim().toLowerCase() === "back";
}

async function finalizeLead(waNumber: string, conv: any, product: any) {
  const result = await createLeadFromConversation(conv, product);
  if (!result) {
    await sendText(waNumber, "Sorry, we're temporarily unable to process that request. Please try again or choose Talk to Loan Expert.");
    return;
  }
  await updateConversation(conv.id, { lead_id: result.leadId });

  const name = conv.answers.full_name ?? "there";
  const amount = conv.answers.loan_amount ?? conv.answers.total_project_cost;
  const amountText = typeof amount === "number" ? `Rs. ${amount.toLocaleString("en-IN")}` : "as discussed";

  await sendText(
    waNumber,
    `Thank you, ${name}! 🙏\n\nWe have received your loan requirement.\n\nProduct: ${product.label}\nRequired Amount: ${amountText}\nLocation: ${conv.answers.city ?? conv.answers.project_location ?? "-"}\n\nBased on the information provided, your requirement may be suitable for review by our lending partners. Your requirement has been registered with Solitaire Finz Mart.\n\nReference ID: ${result.leadId}\n\nOur loan team will contact you for the next steps.`,
  );
  await sendButtons(waNumber, "What would you like to do next?", ["Talk to Expert", "Submit Documents", "Main Menu"]);
}

async function handOverToAgent(waNumber: string, conv: any, silent = false) {
  await updateConversation(conv.id, { handed_to_agent: true, status: "active" });
  if (!silent) {
    await sendText(waNumber, "Connecting you with a member of our loan team — they'll take it from here. You can type \"Main Menu\" anytime to return to the automated assistant.");
  }
  // If a lead already exists for this conversation, log the handover;
  // otherwise there's nothing to assign yet (staff will follow up from
  // the WhatsApp Conversations view once the Admin Panel section is wired up).
  if (conv.lead_id) {
    await sb.from("workflow_history").insert({
      lead_id: conv.lead_id,
      action: "Escalated to human agent via WhatsApp",
      user_name: "WhatsApp Bot",
      role: "system",
    });
  }
}

async function sendApplicationStatus(waNumber: string, conv: any) {
  const { data: leads } = await sb
    .from("leads")
    .select("id, loan_type, stage, status, updated_at")
    .eq("borrower->>phone", waNumber)
    .order("updated_at", { ascending: false })
    .limit(5);

  if (!leads || !leads.length) {
    await sendText(waNumber, "We couldn't find an existing application under this number. Would you like to submit a new loan requirement?");
    await updateConversation(conv.id, { state: "MAIN_MENU" });
    return sendMainMenu(waNumber, conv);
  }

  if (leads.length === 1) {
    return sendSingleStatus(waNumber, conv, leads[0]);
  }

  const labels = leads.map((l) => `${l.loan_type ?? "Loan"} (#${l.id})`);
  await updateConversation(conv.id, { state: "STATUS_SELECT", answers: { ...conv.answers, _statusLeadIds: leads.map((l) => l.id) } });
  const msg = await sendOptions(waNumber, "You have more than one application on record. Which one would you like to check?", labels, "Select");
  await logMessage(conv.id, "outbound", "[status select]", msg?.messages?.[0]?.id, "interactive");
}

async function handleStatusSelectReply(waNumber: string, conv: any, optionIndex: number | null) {
  const ids: number[] = conv.answers?._statusLeadIds ?? [];
  if (optionIndex === null || !ids[optionIndex]) {
    await sendText(waNumber, "I didn't quite understand that. Please select one of the options below.");
    return;
  }
  const { data: lead } = await sb.from("leads").select("id, loan_type, stage, status, updated_at").eq("id", ids[optionIndex]).maybeSingle();
  if (!lead) return;
  return sendSingleStatus(waNumber, conv, lead);
}

async function sendSingleStatus(waNumber: string, conv: any, lead: any) {
  const updated = new Date(lead.updated_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  await sendText(
    waNumber,
    `Application Status\n\nApplication ID: ${lead.id}\nProduct: ${lead.loan_type ?? "-"}\nStage: ${lead.stage ?? "-"}\nStatus: ${lead.status ?? "-"}\n\nLast Updated: ${updated}`,
  );
  await updateConversation(conv.id, { state: "MAIN_MENU" });
  return sendMainMenu(waNumber, conv);
}

// ---------------------------------------------------------
// HTTP entrypoint
// ---------------------------------------------------------
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // --- GET: Meta webhook verification (spec section 26) ---
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  // --- POST: incoming WhatsApp events ---
  if (req.method === "POST") {
    const rawBody = await req.text();
    const signature = req.headers.get("x-hub-signature-256");
    const validSig = await verifyMetaSignature(rawBody, signature);
    if (!validSig) {
      console.error("Invalid webhook signature — rejecting");
      return new Response("Invalid signature", { status: 401 });
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response("Bad payload", { status: 400 });
    }

    try {
      const entries = payload.entry ?? [];
      for (const entry of entries) {
        const changes = entry.changes ?? [];
        for (const change of changes) {
          const value = change.value ?? {};
          const messages = value.messages ?? [];
          for (const message of messages) {
            // Idempotency: skip if we've already processed this message id.
            const { error: dupError } = await sb.from("whatsapp_webhook_events").insert({ wa_message_id: message.id });
            if (dupError) {
              // unique_violation => already processed
              continue;
            }
            const waNumber = normalizePhone(message.from);
            await handleIncomingMessage(waNumber, message);
          }
          // Delivery/read status updates — logged only, no customer-facing action needed.
          const statuses = value.statuses ?? [];
          for (const status of statuses) {
            console.log("WhatsApp status update", status.id, status.status);
          }
        }
      }
    } catch (err) {
      console.error("Webhook processing error", err);
      // Always return 200 to Meta even on internal errors, to avoid
      // Meta retry storms; the error is logged for investigation.
    }

    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  return new Response("Method not allowed", { status: 405 });
});
