// =========================================================
// SOLITAIRE FINZ MART — whatsapp-notify
//
// Updated notification function:
// 1. Pre-Disbursement → pre_disbursement_formalities
// 2. Disbursed → loan_disbursement_success
// 3. Feedback Pending → customer_feedback_request
//
// Existing status notifications are preserved for:
// New, Legal Review, Technical Review, Credit Review, Sanctioned, Rejected.
//
// Called by Postgres trigger (trg_notify_lead_status_change).
// No changes are required in the existing apps.
//
// IMPORTANT:
// - Set WHATSAPP_TEMPLATE_LANGUAGE to the exact language/locale used
//   by your approved Meta templates (commonly "en_US" or "en").
// - Template names must exactly match the names approved in WhatsApp Manager.
// - Feedback is sent when the lead reaches "Feedback Pending" (or a
//   supported feedback stage/status). This avoids sending feedback
//   immediately at the moment of disbursement.
// =========================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN")!;
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")!;
const LEAD_NOTIFY_SECRET = Deno.env.get("LEAD_NOTIFY_SECRET")!;

// Set this to the exact language code shown for your Meta template.
// Example: "en_US" or "en".
const WHATSAPP_TEMPLATE_LANGUAGE =
  Deno.env.get("WHATSAPP_TEMPLATE_LANGUAGE") || "en_US";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const GRAPH_URL =
  `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

// Existing customer-facing text notifications.
// These deliberately do not promise approval, rate, or disbursement
// except where the actual stage itself is "Disbursed".
const STAGE_MESSAGES: Record<string, string> = {
  "New":
    "We've received your loan requirement and it's now with our team for review.",
  "Legal Review":
    "Your application has moved to legal document review.",
  "Technical Review":
    "Your application has moved to technical evaluation.",
  "Credit Review":
    "Your application is now under credit review.",
  "Sanctioned":
    "Good news — your loan application has been sanctioned. Our team will reach out with next steps.",
  "Rejected":
    "There has been an update on your application. Our team will contact you shortly to discuss further.",
};

// Accepted stage/status names for the new template workflow.
// Adjust these aliases only if your database uses a different exact label.
const PRE_DISBURSEMENT_VALUES = new Set([
  "Pre-Disbursement",
  "Pre Disbursement",
  "Pre-Disbursement Pending",
  "Pre Disbursement Pending",
]);

const FEEDBACK_VALUES = new Set([
  "Feedback Pending",
  "Feedback",
  "Customer Feedback",
]);

function cleanPhone(value: unknown): string | null {
  if (!value) return null;
  const phone = String(value).replace(/[^\d+]/g, "");
  return phone || null;
}

function firstDefined(...values: unknown[]): unknown {
  return values.find(
    (value) => value !== undefined && value !== null && String(value).trim() !== "",
  );
}

function formatAmount(value: unknown): string {
  if (value === undefined || value === null || String(value).trim() === "") {
    return "As per sanction";
  }

  const raw = String(value).replace(/[₹,\s]/g, "");

  // Preserve values that are not simple numeric amounts.
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return String(value);

  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return String(value);

  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
  }).format(numeric);
}

async function sendText(to: string, body: string) {
  const res = await fetch(GRAPH_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: {
        body,
        preview_url: false,
      },
    }),
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.error(
      "whatsapp-notify text send failed",
      res.status,
      JSON.stringify(json),
    );
  }

  return json;
}

async function sendTemplate(
  to: string,
  templateName: string,
  parameters: string[],
) {
  const res = await fetch(GRAPH_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: {
          code: WHATSAPP_TEMPLATE_LANGUAGE,
        },
        components: [
          {
            type: "body",
            parameters: parameters.map((text) => ({
              type: "text",
              text,
            })),
          },
        ],
      },
    }),
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.error(
      "whatsapp-notify template send failed",
      templateName,
      res.status,
      JSON.stringify(json),
    );
  }

  return json;
}

async function logOutboundMessage(
  phone: string,
  result: any,
  messageType: string,
  body: string,
) {
  // Log into the same transcript the bot uses, if this number already
  // has a conversation.
  const { data: conv } = await sb
    .from("whatsapp_conversations")
    .select("id")
    .eq("wa_number", phone)
    .maybeSingle();

  if (conv) {
    await sb.from("whatsapp_messages").insert({
      conversation_id: conv.id,
      direction: "outbound",
      wa_message_id: result?.messages?.[0]?.id ?? null,
      message_type: messageType,
      body,
    });
  }
}

function isPreDisbursement(value: unknown): boolean {
  return PRE_DISBURSEMENT_VALUES.has(String(value || "").trim());
}

function isFeedback(value: unknown): boolean {
  return FEEDBACK_VALUES.has(String(value || "").trim());
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

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

  const {
    lead_id,
    stage,
    status,
    previous_stage,
    previous_status,
  } = body;

  if (!lead_id) {
    return new Response("Missing lead_id", { status: 400 });
  }

  // Select the complete lead row so this function does not depend on a
  // particular amount/reference column existing in every app schema.
  const { data: lead, error: leadError } = await sb
    .from("leads")
    .select("*")
    .eq("id", lead_id)
    .maybeSingle();

  if (leadError) {
    console.error("Failed to load lead", leadError);
    return new Response("Failed to load lead", { status: 500 });
  }

  const borrower = lead?.borrower ?? {};

  const phone = cleanPhone(
    firstDefined(
      borrower?.phone,
      borrower?.whatsapp,
      borrower?.mobile,
      lead?.phone,
      lead?.whatsapp,
      lead?.mobile,
    ),
  );

  if (!lead || !phone) {
    // No phone on file (for example, a manually created lead).
    return new Response("No phone on file, skipped", { status: 200 });
  }

  const customerName = String(
    firstDefined(
      borrower?.name,
      borrower?.full_name,
      lead?.customer_name,
      lead?.name,
      "there",
    ),
  ).trim();

  const productLabel = String(
    firstDefined(
      lead?.loan_type,
      lead?.product,
      lead?.loan_product,
      borrower?.loan_type,
      "loan",
    ),
  ).trim();

  // Prefer an explicit disbursed amount, then sanctioned amount.
  const amount = firstDefined(
    lead?.disbursed_amount,
    lead?.disbursement_amount,
    lead?.loan_disbursed_amount,
    lead?.sanctioned_amount,
    lead?.sanction_amount,
    lead?.loan_amount,
  );

  // Keep the database lead ID as the stable fallback reference.
  const referenceId = String(
    firstDefined(
      lead?.reference_id,
      lead?.application_reference,
      lead?.application_id,
      lead?.ref_id,
      lead?.id,
    ),
  );

  let result: any = null;
  let messageType = "text";
  let loggedBody = "";

  const stageChanged = stage !== previous_stage;
  const statusChanged = status !== previous_status;

  // ---------------------------------------------------------
  // 1. PRE-DISBURSEMENT
  // ---------------------------------------------------------
  if (
    (stageChanged && isPreDisbursement(stage)) ||
    (statusChanged && isPreDisbursement(status))
  ) {
    const parameters = [
      customerName,
      productLabel,
      formatAmount(
        firstDefined(
          lead?.sanctioned_amount,
          lead?.sanction_amount,
          lead?.loan_amount,
        ),
      ),
      referenceId,
    ];

    result = await sendTemplate(
      phone,
      "pre_disbursement_formalities",
      parameters,
    );

    messageType = "template";
    loggedBody =
      `Pre-disbursement formalities notification sent. ` +
      `Reference ID: ${referenceId}`;

  // ---------------------------------------------------------
  // 2. DISBURSED
  // ---------------------------------------------------------
  } else if (
    (stageChanged && String(stage || "").trim() === "Disbursed") ||
    (statusChanged && String(status || "").trim() === "Disbursed")
  ) {
    const parameters = [
      customerName,
      productLabel,
      formatAmount(amount),
      referenceId,
    ];

    result = await sendTemplate(
      phone,
      "loan_disbursement_success",
      parameters,
    );

    messageType = "template";
    loggedBody =
      `Loan disbursement success notification sent. ` +
      `Reference ID: ${referenceId}`;

  // ---------------------------------------------------------
  // 3. FEEDBACK REQUEST
  //
  // We intentionally do NOT send this at the exact same moment
  // as "Disbursed". Set stage/status to "Feedback Pending" later
  // when you want the feedback template to go out.
  // ---------------------------------------------------------
  } else if (
    (stageChanged && isFeedback(stage)) ||
    (statusChanged && isFeedback(status))
  ) {
    const parameters = [customerName, referenceId];

    result = await sendTemplate(
      phone,
      "customer_feedback_request",
      parameters,
    );

    messageType = "template";
    loggedBody =
      `Customer feedback request sent. ` +
      `Reference ID: ${referenceId}`;

  // ---------------------------------------------------------
  // 4. EXISTING TEXT STATUS NOTIFICATIONS
  // ---------------------------------------------------------
  } else if (stageChanged && STAGE_MESSAGES[stage]) {
    loggedBody =
      `Hi ${customerName}, an update on your ${productLabel} application ` +
      `(${referenceId}):\n\n${STAGE_MESSAGES[stage]}`;

    result = await sendText(phone, loggedBody);
    messageType = "text";

  } else if (statusChanged) {
    loggedBody =
      `Hi ${customerName}, your ${productLabel} application ` +
      `(${referenceId}) status has been updated to: ${status}.`;

    result = await sendText(phone, loggedBody);
    messageType = "text";
  }

  if (!result) {
    return new Response(
      "No customer-facing change, skipped",
      { status: 200 },
    );
  }

  // Meta can return an error payload even when fetch itself succeeds.
  if (!result?.messages?.[0]?.id) {
    console.error(
      "WhatsApp notification did not return a message ID",
      JSON.stringify(result),
    );

    // Return an error so a failed template send is visible to the
    // calling trigger/monitoring system.
    return new Response("WhatsApp send failed", { status: 502 });
  }

  await logOutboundMessage(
    phone,
    result,
    messageType,
    loggedBody,
  );

  return new Response("OK", { status: 200 });
});
