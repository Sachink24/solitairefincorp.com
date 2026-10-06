// =========================================================
// SOLITAIRE FINZ MART — WhatsApp Cloud API webhook + bot engine
// Deployed as a Supabase Edge Function.
//
// FIX (this version): after a lead is created the conversation state is
// "COMPLETED", and the confirmation message offers three buttons:
// "Talk to Expert", "Submit Documents", "Main Menu". "Talk to Expert" and
// "Main Menu" were already caught by the global AGENT_WORDS / RESET_WORDS
// shortcuts, but "Submit Documents" fell through to the default case in
// the state switch and just re-sent the main menu — so the customer could
// never start document upload straight from the confirmation message.
// Added a COMPLETED case that starts the AWAITING_DOCUMENTS flow for the
// lead that was just created.
//
// FIX (earlier version): Gemini calls were failing with HTTP 404 —
// "models/gemini-2.0-flash is no longer available" — because that model
// was deprecated by Google. Default model bumped to gemini-3.8-flash (the
// current generally-available Flash model as of this fix), and auth
// switched from the ?key= query param to the x-goog-api-key header, which
// is what Google's current quickstart docs show. GEMINI_MODEL remains
// overridable via secret if Google deprecates this one too.
//
// FIX (earlier version): tapping the "Check Application Status" MAIN_MENU
// button a second time while already in STATUS_SELECT state (waiting on a
// previous multi-lead picker) fell through to "which list item did you
// pick?" logic instead of restarting the status check — because the
// button's exact text, "Check Application Status", wasn't in the global
// STATUS_WORDS shortcut list, only "application status" was. This let a
// stale button tap be misread as picking a list position by coincidence,
// silently showing the wrong lead. Added the exact phrase so this global
// shortcut always takes priority over state-based routing, regardless of
// what state the conversation happens to be in.
//
// FIX (earlier version): WhatsApp rejects an ENTIRE interactive message
// with (#131009) "Duplicate button title" if two option labels become
// identical after truncation. The multi-application status picker built
// labels like "Personal Loan (#1790018722225)" and truncated to 20 chars
// for button mode — since lead IDs are millisecond timestamps, two
// same-type applications created close together often share enough
// leading digits that BOTH labels truncate to the exact same string, so
// Meta silently rejected the whole message. Labels now use a simple
// 1-based index prefix ("1. Personal Loan", "2. Personal Loan") which is
// always unique from the very first character, regardless of truncation.
//
// FIX (earlier version): "Check Application Status" was only ever shown as
// a menu option to numbers flagged is_existing_customer=true — but that
// flag is set ONCE, at the very first message, and never re-evaluated.
// mainMenuOptions() now shows the same full menu to everyone.
//
// FIX (earlier version): findLeadsByPhone()'s confirmation step reads
// l.borrower?.phone, but callers sometimes requested a column list that
// didn't include "borrower" — so every row was silently filtered out.
// findLeadsByPhone now always appends "borrower" to the select.
//
// FIX (earlier version): phone numbers are stored in wildly inconsistent
// formats across the different apps in this system. findLeadsByPhone()/
// last10() now compare normalized digits instead of exact strings.
//
// ADDED (earlier version): notifications to staff for two events that
// previously only wrote to workflow_history — a customer finishing
// document upload, and a customer asking for a human agent. Both now also
// call public.create_notification() so the bell in index.html picks them
// up, same as every other workflow event.
//
// ADDED (earlier version): Gemini-powered assist — smart extraction from
// free-typed answers, FAQ-style answers to "Other Query" and mid-flow
// questions, both grounded to this business only and never promising
// approval/rate/amount. Requires a GEMINI_API_KEY secret; everything falls
// back to the exact prior deterministic behavior if that secret is absent
// or any call fails.
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
const GRAPH_URL = `https://graph.facebook.com/v26.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

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
  let diff = 0;
  for (let i = 0; i < computedHex.length; i++) diff |= computedHex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  return diff === 0;
}

async function appsecretProof(): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(META_APP_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(WHATSAPP_ACCESS_TOKEN));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function waSend(body: Record<string, unknown>) {
  const proof = await appsecretProof();
  const res = await fetch(`${GRAPH_URL}?appsecret_proof=${proof}`, {
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

async function sendOptions(to: string, bodyText: string, options: string[], listButtonLabel = "Choose") {
  if (options.length <= 3) return sendButtons(to, bodyText, options);
  return sendList(to, bodyText, listButtonLabel, options);
}

async function fetchWhatsAppMedia(mediaId: string): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const proof = await appsecretProof();
  const metaRes = await fetch(`https://graph.facebook.com/v26.0/${mediaId}?appsecret_proof=${proof}`, {
    headers: { "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}` },
  });
  if (!metaRes.ok) {
    console.error("media metadata fetch failed", metaRes.status);
    return null;
  }
  const meta = await metaRes.json();
  const fileRes = await fetch(meta.url, { headers: { "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}` } });
  if (!fileRes.ok) {
    console.error("media download failed", fileRes.status);
    return null;
  }
  const bytes = new Uint8Array(await fileRes.arrayBuffer());
  return { bytes, mimeType: meta.mime_type ?? "application/octet-stream" };
}

function extensionForMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
    "application/pdf": "pdf",
    "video/mp4": "mp4",
  };
  return map[mime] ?? "bin";
}

function normalizePhone(raw: string): string {
  return raw.replace(/[^\d]/g, "");
}

function digitsOnly(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}
function last10(s: string | null | undefined): string {
  return digitsOnly(s).slice(-10);
}

async function findLeadsByPhone(waNumber: string, columns: string) {
  const suffix5 = waNumber.slice(-5);
  const selectCols = columns.includes("borrower") ? columns : `${columns}, borrower`;
  const { data } = await sb
    .from("leads")
    .select(selectCols)
    .ilike("borrower->>phone", `%${suffix5}`)
    .order("updated_at", { ascending: false })
    .limit(50);
  const target = last10(waNumber);
  return (data ?? []).filter((l: any) => last10(l.borrower?.phone) === target);
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

function extractReferralCode(text: string): string | null {
  if (!text) return null;
  const labeled = text.match(/\b(?:referral|ref)\s*[:\-]?\s*([A-Z2-9]{6})\b/i);
  if (labeled) return labeled[1].toUpperCase();
  const bare = text.trim().match(/^([A-Z2-9]{6})$/i);
  if (bare) return bare[1].toUpperCase();
  return null;
}

async function resolveReferralBA(code: string): Promise<{ email: string; name: string | null } | null> {
  const { data } = await sb
    .from("business_associates")
    .select('email, "NAME", status')
    .eq("referral_code", code)
    .maybeSingle();
  if (!data || data.status !== "active") return null;
  return { email: data.email, name: data.NAME ?? null };
}

// Fire-and-forget notification to staff — mirrors what log_lead_workflow()
// does for every other workflow event, for the two events (document
// upload complete, human handover) that this function handles directly
// rather than through one of the RBAC RPCs.
async function notifyStaff(leadId: number | null, recipientEmail: string | null, recipientRole: string | null, type: string, title: string, message: string) {
  try {
    await sb.rpc("create_notification", {
      p_lead_id: leadId,
      p_recipient_email: recipientEmail,
      p_recipient_role: recipientRole,
      p_type: type,
      p_title: title,
      p_message: message,
    });
  } catch (e) {
    console.error("notifyStaff failed", e);
  }
}

const RESET_WORDS = ["main menu", "menu", "restart", "start over"];
const AGENT_WORDS = ["talk to agent", "talk to expert", "talk to loan expert", "agent", "human", "relationship manager"];
const STATUS_WORDS = ["status", "check status", "application status", "check application status", "check my application status", "track application"];
const NEWLOAN_WORDS = ["apply", "new loan", "start application", "new loan requirement", "apply for loan"];

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

async function getOrCreateConversation(waNumber: string, firstMessageText: string) {
  const { data: existing } = await sb.from("whatsapp_conversations").select("*").eq("wa_number", waNumber).maybeSingle();
  if (existing) return { conversation: existing, isNew: false };

  const priorLeads = await findLeadsByPhone(waNumber, "id, loan_type, stage, status, created_at, borrower");
  priorLeads.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const isExisting = priorLeads.length > 0;
  const displayName = isExisting ? (priorLeads[0].borrower?.name ?? null) : null;

  let referredByBa: string | null = null;
  let referralCodeUsed: string | null = null;
  let referredByName: string | null = null;
  const code = extractReferralCode(firstMessageText);
  if (code) {
    const ba = await resolveReferralBA(code);
    if (ba) {
      referredByBa = ba.email;
      referredByName = ba.name;
      referralCodeUsed = code;
    }
  }

  const { data: created, error } = await sb.from("whatsapp_conversations").insert({
    wa_number: waNumber,
    display_name: displayName,
    is_existing_customer: isExisting,
    matched_lead_id: isExisting ? priorLeads[0].id : null,
    state: "MAIN_MENU",
    referred_by_ba: referredByBa,
    referral_code_used: referralCodeUsed,
  }).select("*").single();

  if (error) throw error;
  return { conversation: created, isNew: true, referredByName };
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

  const { data: bas } = await sb.from("business_associates").select("email").eq("status", "active");
  if (!bas || !bas.length) return null;
  const counts = await Promise.all(bas.map(async (ba) => {
    const { count } = await sb.from("leads").select("id", { count: "exact", head: true }).eq("assigned_ba", ba.email);
    return { email: ba.email, count: count ?? 0 };
  }));
  counts.sort((a, b) => a.count - b.count);
  return counts[0]?.email ?? null;
}

async function createLeadFromConversation(conv: any, product: any) {
  const answers = conv.answers ?? {};

  let assignedBa: string | null = null;
  let leadSource = "whatsapp_organic";
  if (conv.referred_by_ba) {
    const { data: ba } = await sb.from("business_associates").select("email, status").eq("email", conv.referred_by_ba).maybeSingle();
    if (ba && ba.status === "active") {
      assignedBa = ba.email;
      leadSource = "whatsapp_referral";
    }
  }
  if (!assignedBa) {
    assignedBa = await pickAssignedBA(product.key, answers.city ?? answers.project_location ?? null);
  }

  const borrower: Record<string, unknown> = {
    name: answers.full_name ?? null,
    phone: conv.wa_number,
    location: answers.city ?? answers.project_location ?? null,
    income: answers.monthly_income ?? answers.annual_turnover ?? null,
    employment: answers.customer_type ?? null,
  };

  const { data: lead, error } = await sb.from("leads").insert({
    id: Date.now(),
    borrower,
    loan_type: product.loan_type,
    loan_amount: answers.loan_amount ?? answers.total_project_cost ?? null,
    assigned_ba: assignedBa,
    stage: "New",
    status: "NEW",
    created_by: "WhatsApp Bot",
    lead_source: leadSource,
    referred_by_ba: conv.referred_by_ba ?? null,
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
    remarks: conv.referred_by_ba
      ? `Product: ${product.label}. Referred by BA: ${assignedBa} (code ${conv.referral_code_used}). Captured via automated WhatsApp conversation.`
      : `Product: ${product.label}. Assigned BA: ${assignedBa ?? "unassigned"}. Captured via automated WhatsApp conversation.`,
  });

  return { leadId: lead.id as number, assignedBa };
}

async function handleIncomingMessage(waNumber: string, message: any) {
  const { text, optionIndex } = extractReply(message);
  const { conversation, isNew, referredByName } = await getOrCreateConversation(waNumber, text);
  await logMessage(conversation.id, "inbound", text, message.id, message.type, message);

  const lower = text.trim().toLowerCase().replace(/^\//, "");

  if (RESET_WORDS.includes(lower)) {
    await updateConversation(conversation.id, { state: "MAIN_MENU", product_key: null, question_index: 0, answers: {}, handed_to_agent: false });
    return sendMainMenu(waNumber, conversation);
  }
  if (AGENT_WORDS.some(w => lower.includes(w))) {
    return handOverToAgent(waNumber, conversation);
  }
  if (STATUS_WORDS.includes(lower)) {
    return sendApplicationStatus(waNumber, conversation);
  }
  if (NEWLOAN_WORDS.includes(lower)) {
    await updateConversation(conversation.id, { state: "PRODUCT_SELECT", handed_to_agent: false });
    return sendProductMenu(waNumber, conversation.id);
  }
  if (conversation.handed_to_agent) {
    return;
  }

  if (isNew) {
    if (referredByName) {
      await sendText(waNumber, `You've been referred by ${referredByName} from Solitaire Finz Mart! 🙏`);
    }
    const products = await getActiveProducts();
    const handledDeepLink = await tryProductDeepLink(waNumber, conversation, text, products);
    if (handledDeepLink) return;
    return sendWelcome(waNumber, conversation);
  }

  switch (conversation.state) {
    case "MAIN_MENU":
      return handleMainMenuReply(waNumber, conversation, optionIndex, text);
    case "PRODUCT_SELECT":
      return handleProductSelectReply(waNumber, conversation, optionIndex, text);
    case "ASKING_QUESTION":
      return handleQuestionReply(waNumber, conversation, text, optionIndex);
    case "STATUS_SELECT":
      return handleStatusSelectReply(waNumber, conversation, optionIndex);
    case "AWAITING_DOCUMENTS":
      return handleDocumentUpload(waNumber, conversation, message, text);
    case "AI_QUERY":
      return handleAIQueryReply(waNumber, conversation, text);
    case "COMPLETED": {
      // Replies to the buttons sent right after a lead is created.
      // "Talk to Expert" and "Main Menu" are already caught by the global
      // AGENT_WORDS / RESET_WORDS shortcuts above, so only "Submit
      // Documents" needs handling here.
      if (lower === "submit documents" && conversation.lead_id) {
        await updateConversation(conversation.id, { state: "AWAITING_DOCUMENTS" });
        await sendText(waNumber, 'Please send your documents now as photos or PDFs, one at a time. Type "Done" once you\'ve sent everything.');
        return;
      }
      await updateConversation(conversation.id, { state: "MAIN_MENU" });
      return sendMainMenu(waNumber, conversation);
    }
    default:
      await updateConversation(conversation.id, { state: "MAIN_MENU" });
      return sendMainMenu(waNumber, conversation);
  }
}

async function tryProductDeepLink(waNumber: string, conv: any, rawText: string, products: any[]): Promise<boolean> {
  if (!rawText) return false;
  const lower = rawText.toLowerCase();
  const matched = products.find((p) => lower.includes(p.label.toLowerCase()));
  if (!matched) return false;

  await updateConversation(conv.id, { state: "ASKING_QUESTION", product_key: matched.key, question_index: 0, answers: {} });

  const greeting = conv.is_existing_customer
    ? `Welcome back to Solitaire Finz Mart${conv.display_name ? ", " + conv.display_name : ""}! 👋\n\nLet's get your ${matched.label} enquiry started.`
    : `Welcome to Solitaire Finz Mart! 👋\n\nLet's get your ${matched.label} enquiry started.`;
  await sendText(waNumber, greeting);
  await askQuestion(waNumber, conv, matched, 0);
  return true;
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
  return ["New Loan Requirement", "Check Application Status", "Submit Documents", "Talk to Loan Expert", "Other Query"];
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
    const targetLeadId = conv.lead_id ?? conv.matched_lead_id;
    if (!targetLeadId) {
      await sendText(waNumber, "We don't have an active loan application on file for this number yet. Let's start a New Loan Requirement first — you'll be able to share documents once that's created.");
      await updateConversation(conv.id, { state: "MAIN_MENU" });
      return sendMainMenu(waNumber, conv);
    }
    await updateConversation(conv.id, { state: "AWAITING_DOCUMENTS", lead_id: targetLeadId });
    await sendText(waNumber, 'Please send your documents now as photos or PDFs, one at a time. Type "Done" once you\'ve sent everything.');
    return;
  }
  if (choice === "Other Query") {
    await updateConversation(conv.id, { state: "AI_QUERY" });
    await sendText(waNumber, "Sure — what would you like to know?");
    return;
  }
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
      return handleUnrecognizedAnswer(waNumber, conv, product, questions, text, "I didn't quite understand that. Please select one of the options below.");
    }
  } else if (q.type === "number") {
    value = parseAmount(text);
    if (value === null) {
      return handleUnrecognizedAnswer(waNumber, conv, product, questions, text, "Please enter a valid amount (numbers only, e.g. 2500000 or 25 lakh).");
    }
  } else {
    if (q.key === "full_name" && !isValidName(text)) {
      return handleUnrecognizedAnswer(waNumber, conv, product, questions, text, "Please enter your full name (at least 3 letters).");
    }
    value = text.trim();
  }

  const updatedAnswers = { ...conv.answers, [q.key]: value };
  const nextIndex = nextUnansweredIndex(questions, updatedAnswers);

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

// ---------------------------------------------------------
// Gemini assist — three jobs, all optional/best-effort:
//  1. Structured extraction from free-typed answers that don't match the
//     simple deterministic parser (e.g. "around 25 lakh for a flat in
//     Thane" fills amount + city + product at once).
//  2. FAQ-style answers to open-ended questions, both from the main menu
//     ("Other Query") and mid-question-flow (customer asks something
//     instead of answering, gets an answer, then resumes where they left
//     off).
//  3. Conversation summaries for staff (separate whatsapp-summarize
//     function, not here).
//
// Every call degrades gracefully: if GEMINI_API_KEY isn't set, or the API
// call fails for any reason, callers fall back to the original
// deterministic behavior exactly as before this feature existed. No
// Gemini call can ever block or crash the bot.
// ---------------------------------------------------------
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash";

const COMPANY_CONTEXT = `You are a helpful assistant for SOLITAIRE FINZ MART, a loan and financial advisory business in Thane-Bhiwandi, Maharashtra, India. They assist customers with Home Loans, Loan Against Property, Business Loans, Personal Loans, Project/Construction Finance, and Vehicle/Commercial Vehicle Finance, coordinating with multiple banks and NBFC lending partners.

Rules you must always follow:
- Never state or imply a guaranteed loan approval, a specific interest rate, or a guaranteed loan amount.
- If asked about specific rates, eligibility, or approval chances, explain these depend on the lending institution's own assessment, and offer to connect the customer with a loan expert.
- Keep answers friendly, professional, and under 80 words.
- If you don't know something specific to this business, say so honestly and offer to connect them with a loan expert rather than guessing.
- Do not discuss topics unrelated to loans, financing, or this business — politely redirect instead.`;

async function callGemini(systemPrompt: string, userText: string, jsonMode = false): Promise<string | null> {
  if (!GEMINI_API_KEY) return null;
  try {
    const generationConfig: Record<string, unknown> = { temperature: 0.3, maxOutputTokens: 400 };
    if (jsonMode) generationConfig.responseMimeType = "application/json";
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: userText }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig,
        }),
      },
    );
    if (!res.ok) {
      console.error("Gemini API error", res.status, await res.text());
      return null;
    }
    const json = await res.json();
    return json?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch (err) {
    console.error("Gemini call failed", err);
    return null;
  }
}

async function geminiExtractAnswers(product: any, remainingQuestions: any[], text: string): Promise<Record<string, unknown> | null> {
  const schema = remainingQuestions.map((q: any) => ({ key: q.key, label: q.label, type: q.type, options: q.options ?? null }));
  const prompt = `The customer is applying for a ${product.label}. Here are the remaining unanswered questions (as JSON): ${JSON.stringify(schema)}.
Extract ONLY the fields you are confident the customer's message below actually answers. Respond with a JSON object mapping each question "key" to the extracted value — nothing else, no explanation.
For "list" type fields, the value MUST exactly match one of that question's "options" strings.
For "number" type fields, respond with a plain number (no currency symbols or words) — convert "lakh"/"lac" to that number times 100000, and "crore"/"cr" to that number times 10000000.
Omit any field you are not confident about. If nothing in the message matches any field, respond with {}.`;
  const raw = await callGemini(prompt, text, true);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

function looksLikeQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (t.endsWith("?")) return true;
  return /^(what|how|why|can|does|is|are|do|will|when|where|which|who|could|should)\b/.test(t);
}

async function geminiAnswerQuery(text: string): Promise<string | null> {
  const answer = await callGemini(COMPANY_CONTEXT, text, false);
  return answer ? answer.trim() : null;
}

function nextUnansweredIndex(questions: any[], answers: Record<string, unknown>): number {
  for (let i = 0; i < questions.length; i++) {
    const v = answers[questions[i].key];
    if (v === undefined || v === null) return i;
  }
  return questions.length;
}

// Called whenever the deterministic parser can't make sense of an answer.
// Tries Gemini extraction first (across ALL remaining questions, not just
// the current one — so one message can fill several fields); if that
// doesn't resolve the current question, checks whether the message looks
// like a question instead of an answer, and if so answers it via Gemini
// and then resumes the SAME question afterward. Only falls back to the
// plain re-prompt if neither helps (including when Gemini is unconfigured).
async function handleUnrecognizedAnswer(waNumber: string, conv: any, product: any, questions: any[], text: string, fallbackMessage: string) {
  const currentQ = questions[conv.question_index];
  const remaining = questions.slice(conv.question_index);
  const extracted = await geminiExtractAnswers(product, remaining, text);

  if (extracted && Object.keys(extracted).length > 0) {
    const validated: Record<string, unknown> = {};
    for (const q of remaining) {
      const v = (extracted as Record<string, unknown>)[q.key];
      if (v === undefined || v === null) continue;
      if (q.type === "list") {
        const match = (q.options as string[]).find((o) => o.toLowerCase() === String(v).toLowerCase());
        if (match) validated[q.key] = match;
      } else if (q.type === "number") {
        const n = typeof v === "number" ? v : parseAmount(String(v));
        if (n !== null) validated[q.key] = n;
      } else {
        if (String(v).trim().length > 0) validated[q.key] = String(v).trim();
      }
    }

    if (validated[currentQ.key] !== undefined) {
      const updatedAnswers = { ...conv.answers, ...validated };
      const nextIndex = nextUnansweredIndex(questions, updatedAnswers);
      if (nextIndex >= questions.length) {
        await updateConversation(conv.id, { answers: updatedAnswers, state: "COMPLETED" });
        return finalizeLead(waNumber, { ...conv, answers: updatedAnswers }, product);
      }
      await updateConversation(conv.id, { answers: updatedAnswers, question_index: nextIndex });
      return askQuestion(waNumber, conv, product, nextIndex);
    }
  }

  if (looksLikeQuestion(text)) {
    const answer = await geminiAnswerQuery(text);
    if (answer) {
      await sendText(waNumber, answer);
      await sendText(waNumber, "Now, back to your application:");
      return askQuestion(waNumber, conv, product, conv.question_index);
    }
  }

  await sendText(waNumber, fallbackMessage);
  return askQuestion(waNumber, conv, product, conv.question_index);
}

// "Other Query" from the main menu, and any follow-up question while in
// that state — answered via Gemini, grounded to this business only.
async function handleAIQueryReply(waNumber: string, conv: any, text: string) {
  if (text.trim().toLowerCase() === "ask another") {
    await sendText(waNumber, "Sure — what would you like to know?");
    return;
  }
  const answer = await geminiAnswerQuery(text);
  if (!answer) {
    await sendText(waNumber, "I'm not able to answer that right now — let me connect you with a loan expert instead.");
    return handOverToAgent(waNumber, conv);
  }
  await sendText(waNumber, answer);
  await sendButtons(waNumber, "Anything else?", ["Ask Another", "Talk to Expert", "Main Menu"]);
}

async function handleDocumentUpload(waNumber: string, conv: any, message: any, text: string) {
  if (text.trim().toLowerCase() === "done") {
    await sendText(waNumber, "Thanks — we've received your documents. Our team will review them and follow up if anything else is needed.");
    if (conv.lead_id) {
      await sb.from("workflow_history").insert({
        lead_id: conv.lead_id,
        action: "Documents submitted via WhatsApp",
        user_name: "WhatsApp Bot",
        role: "system",
      });
      const { data: leadRow } = await sb.from("leads").select("assigned_ba, borrower").eq("id", conv.lead_id).maybeSingle();
      const borrowerName = leadRow?.borrower?.name ?? "A customer";
      if (leadRow?.assigned_ba) {
        await notifyStaff(conv.lead_id, leadRow.assigned_ba, null, "documents_submitted",
          "Documents received", `${borrowerName} has finished sending documents via WhatsApp.`);
      }
    }
    await updateConversation(conv.id, { state: "MAIN_MENU" });
    return sendMainMenu(waNumber, conv);
  }

  const mediaObj = message.image ?? message.document ?? message.video;
  if (!mediaObj) {
    await sendText(waNumber, 'Please send a photo or PDF document, or type "Done" when finished.');
    return;
  }

  const media = await fetchWhatsAppMedia(mediaObj.id);
  if (!media) {
    await sendText(waNumber, "Sorry, we couldn't process that file. Please try sending it again.");
    return;
  }

  const ext = extensionForMime(media.mimeType);
  const fileName = mediaObj.filename ?? `whatsapp-${Date.now()}.${ext}`;
  const storagePath = `${conv.lead_id}/whatsapp/${Date.now()}-${fileName}`;

  const { error: uploadError } = await sb.storage.from("lead-documents").upload(storagePath, media.bytes, {
    contentType: media.mimeType,
    upsert: false,
  });
  if (uploadError) {
    console.error("document upload failed", uploadError);
    await sendText(waNumber, "Sorry, we couldn't save that file. Please try sending it again.");
    return;
  }

  await sb.from("lead_documents").insert({
    lead_id: conv.lead_id,
    source: "whatsapp",
    storage_path: storagePath,
    file_name: fileName,
    mime_type: media.mimeType,
    file_size: media.bytes.byteLength,
    uploaded_by: conv.wa_number,
  });

  await sendText(waNumber, 'Got it, thanks! Send more documents or type "Done" when finished.');
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
  if (conv.lead_id) {
    await sb.from("workflow_history").insert({
      lead_id: conv.lead_id,
      action: "Escalated to human agent via WhatsApp",
      user_name: "WhatsApp Bot",
      role: "system",
    });
    const { data: leadRow } = await sb.from("leads").select("assigned_ba, borrower").eq("id", conv.lead_id).maybeSingle();
    const borrowerName = leadRow?.borrower?.name ?? "A customer";
    if (leadRow?.assigned_ba) {
      await notifyStaff(conv.lead_id, leadRow.assigned_ba, null, "handover",
        "Customer wants to talk", `${borrowerName} asked to speak with a human agent on WhatsApp — they're waiting now.`);
    } else {
      await notifyStaff(conv.lead_id, null, "owner", "handover",
        "Customer wants to talk", `${borrowerName} asked to speak with a human agent on WhatsApp — no BA assigned yet.`);
    }
  } else {
    await notifyStaff(null, null, "owner", "handover",
      "Customer wants to talk", `A WhatsApp customer (${waNumber}) asked to speak with a human agent, before completing an application.`);
  }
}

async function sendApplicationStatus(waNumber: string, conv: any) {
  const leads = await findLeadsByPhone(waNumber, "id, loan_type, stage, status, updated_at");
  leads.sort((a: any, b: any) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  const top5 = leads.slice(0, 5);

  if (!top5.length) {
    await sendText(waNumber, "We couldn't find an existing application under this number. Would you like to submit a new loan requirement?");
    await updateConversation(conv.id, { state: "MAIN_MENU" });
    return sendMainMenu(waNumber, conv);
  }

  if (top5.length === 1) {
    return sendSingleStatus(waNumber, conv, top5[0]);
  }

  const labels = top5.map((l: any, i: number) => `${i + 1}. ${l.loan_type ?? "Loan"}`);
  await updateConversation(conv.id, { state: "STATUS_SELECT", answers: { ...conv.answers, _statusLeadIds: top5.map((l: any) => l.id) } });
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

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

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
            const { error: dupError } = await sb.from("whatsapp_webhook_events").insert({ wa_message_id: message.id });
            if (dupError) {
              continue;
            }
            const waNumber = normalizePhone(message.from);
            await handleIncomingMessage(waNumber, message);
          }
          const statuses = value.statuses ?? [];
          for (const status of statuses) {
            console.log("WhatsApp status update", status.id, status.status);
          }
        }
      }
    } catch (err) {
      console.error("Webhook processing error", err);
    }

    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  return new Response("Method not allowed", { status: 405 });
});
