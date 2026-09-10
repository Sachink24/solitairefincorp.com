// =========================================================
// SOLITAIRE FINZ MART — whatsapp-notify
// Called by a Postgres trigger (trg_notify_lead_status_change) whenever
// leads.stage or leads.status changes in ANY of your apps (associate-app,
// Admin Panel, LTC portal) — no changes needed to those apps at all.
//
// Auth: verify_jwt is OFF (the caller is Postgres via pg_net, not a
// logged-in Supabase user). Instead we check a shared secret header
// (x-notify-secret) that only the DB trigger and this function know,
// stored in Supabase Vault on the DB side.
// =========================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN")!;
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")!;
const LEAD_NOTIFY_SECRET = Deno.env.get("LEAD_NOTIFY_SECRET")!;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const GRAPH_URL = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

// Customer-facing copy per stage. Deliberately does not promise approval,
// rate, or disbursement — matches the site/bot's existing compliance stance.
const STAGE_MESSAGES: Record<string, string> = {
  "New": "We've received your loan requirement and it's now with our team for review.",
  "Legal Review": "Your application has moved to legal document review.",
  "Technical Review": "Your application has moved to technical evaluation.",
  "Credit Review": "Your application is now under credit review.",
  "Sanctioned": "Good news — your loan application has been sanctioned. Our team will reach out with next steps.",
  "Disbursed": "Your loan amount has been disbursed. Thank you for choosing Solitaire Finz Mart.",
  "Rejected": "There has been an update on your application. Our team will contact you shortly to discuss further.",
};

async function sendText(to: string, body: string) {
  const res = await fetch(GRAPH_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body, preview_url: false } }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) console.error("whatsapp-notify send failed", res.status, JSON.stringify(json));
  return json;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const secret = req.headers.get("x-notify-secret");
  if (!secret || secret !== LEAD_NOTIFY_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response("Bad payload", { status: 400 });
  }

  const { lead_id, stage, status, previous_stage, previous_status } = body;
  if (!lead_id) return new Response("Missing lead_id", { status: 400 });

  const { data: lead } = await sb.from("leads").select("id, borrower, loan_type").eq("id", lead_id).maybeSingle();
  const phone = lead?.borrower?.phone as string | undefined;
  if (!lead || !phone) {
    // No phone on file (e.g. lead created manually, not via WhatsApp) — nothing to send.
    return new Response("No phone on file, skipped", { status: 200 });
  }

  const name = lead.borrower?.name ? String(lead.borrower.name).split(" ")[0] : "there";
  const ref = `Ref #${lead.id}`;
  const productLabel = lead.loan_type ?? "loan";

  let text: string | null = null;
  if (stage !== previous_stage && STAGE_MESSAGES[stage]) {
    text = `Hi ${name}, an update on your ${productLabel} application (${ref}):\n\n${STAGE_MESSAGES[stage]}`;
  } else if (status !== previous_status) {
    text = `Hi ${name}, your ${productLabel} application (${ref}) status has been updated to: ${status}.`;
  }

  if (!text) {
    return new Response("No customer-facing change, skipped", { status: 200 });
  }

  const result = await sendText(phone, text);

  // Log into the same transcript the bot uses, if this number already has
  // a conversation, so staff see status updates alongside the chat history.
  const { data: conv } = await sb.from("whatsapp_conversations").select("id").eq("wa_number", phone).maybeSingle();
  if (conv) {
    await sb.from("whatsapp_messages").insert({
      conversation_id: conv.id,
      direction: "outbound",
      wa_message_id: result?.messages?.[0]?.id ?? null,
      message_type: "text",
      body: text,
    });
  }

  return new Response("OK", { status: 200 });
});
