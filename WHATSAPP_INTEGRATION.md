# WhatsApp Automation — Solitaire Finz Mart

Real backend, deployed and live. Not a mockup: the webhook is deployed to your
Supabase project right now, the database tables exist, and every lead the bot
creates goes directly into your production `leads` table and starts the real
legal/technical/credit workflow.

**What still needs to happen before this actually sends/receives anything:**
you need to create the Meta WhatsApp Business app and set five secrets (below).
Nothing will respond on WhatsApp until that's done.

---

## 1. What was built

### Database (migrations, already applied)
- `whatsapp_conversations` — one row per WhatsApp number, tracks state, selected product, captured answers (jsonb), and which `leads.id` it produced
- `whatsapp_messages` — full transcript, inbound + outbound
- `whatsapp_webhook_events` — dedupes Meta's webhook deliveries (Meta retries on any non-200 or timeout, so this is required, not optional)
- `whatsapp_products` — the product list + question flow, **editable without touching code** (see section 6)
- `whatsapp_assignment_rules` — optional BA-assignment rules (by product/city); falls back to load-balanced round-robin across your active `business_associates` if no rule matches
- `lead_documents` — metadata (storage path, file name, mime type) for every document collected via WhatsApp, linked to `leads.id`. The actual files live in your existing `lead-documents` storage bucket, at `{lead_id}/whatsapp/{timestamp}-{filename}`.

Also added: the `pg_net` Postgres extension (needed for the status-notify trigger to call an Edge Function), a Vault secret (`lead_notify_secret`) used only by that trigger, and the `trg_notify_lead_status_change` trigger on `leads`.

None of your existing tables, functions, or triggers were altered — only added to. RLS is on for all five new tables; your staff (`authenticated`) can read conversations/messages/documents, and only admin/owner can edit products or rules — matching your existing `is_admin_or_owner()` pattern.

### Edge Function: `whatsapp-webhook`
Deployed and **ACTIVE** at:
```
https://nbpvamrwzqrgoiwpadwc.supabase.co/functions/v1/whatsapp-webhook
```
This is your webhook URL for Meta. `verify_jwt` is off (Meta can't send a Supabase login token) — instead the function verifies Meta's own `X-Hub-Signature-256` HMAC signature on every request and rejects anything that doesn't match, plus checks the verify token on the initial GET handshake.

It handles, for real:
- New vs. existing customer detection (matches the incoming number against `leads.borrower->>'phone'`)
- The full welcome → menu → product → question flow, reading questions from `whatsapp_products` at runtime
- **Website deep-link handoff**: if someone arrives via a product-specific WhatsApp button on the site (message reads "Hi, I'm interested in a Home Loan."), the bot skips the menu entirely and jumps straight into that product's questions
- **Document collection**: in the "Submit Documents" flow, the bot downloads actual photos/PDFs sent over WhatsApp, uploads them to your existing `lead-documents` storage bucket, and records them in a new `lead_documents` table, linked to the lead
- WhatsApp interactive buttons (≤3 options) or lists (>3 options) — not "type a number," except as a typed fallback if someone free-types instead of tapping
- Amount parsing ("25 lakh", "2500000", "1.2 crore")
- Back / Main Menu / Restart / Talk to Agent — recognized at any point in the flow
- Lead creation straight into `leads` (borrower name/phone/location/income/employment, loan_type, loan_amount, stage `New`, status `NEW`) plus a `workflow_history` entry, exactly like your other workflow actions
- BA auto-assignment
- Human handover (flags the conversation; bot goes silent until "Main Menu")
- Existing-customer "Check Application Status" against real `leads` rows

### Edge Function: `whatsapp-notify` (new)
Deployed and **ACTIVE** at:
```
https://nbpvamrwzqrgoiwpadwc.supabase.co/functions/v1/whatsapp-notify
```
This sends **automatic WhatsApp status updates to customers** whenever their lead's `stage` or `status` changes — in *any* of your apps (associate-app, Admin Panel, LTC portal). No code changes were needed in those apps: a new database trigger (`trg_notify_lead_status_change`, fires `AFTER UPDATE` on `leads`, additive alongside your existing `trg_enforce_leads_update`) detects the change and calls this function automatically via `pg_net` (now enabled on your project). The customer gets a plain-language update (e.g. "Your application has moved to legal document review") without your staff doing anything extra — they just update the lead the way they already do.

This function is also secured, just differently: since the caller is Postgres (not a logged-in user or Meta), it checks a shared secret header instead of a JWT or Meta signature. That secret is stored in Supabase Vault on the database side and must also be set as this function's `LEAD_NOTIFY_SECRET` secret (see section 3) — I generated it for you, it's in that section below.

---

## 2. Set up the Meta WhatsApp Cloud API (you asked for this from scratch)

1. **Create a Meta Business Account** (if you don't have one): [business.facebook.com](https://business.facebook.com) → Create Account.
2. **Create a Meta App**: [developers.facebook.com/apps](https://developers.facebook.com/apps) → Create App → type **Business** → name it (e.g. "Solitaire Finz Mart WhatsApp").
3. **Add the WhatsApp product** to the app from the App Dashboard sidebar → Add Product → WhatsApp → Set Up.
4. Meta gives you a **test phone number** for free to start. Under WhatsApp → API Setup, note:
   - **Phone Number ID** → this is `WHATSAPP_PHONE_NUMBER_ID`
   - **Temporary access token** (24-hour, for testing only — see step 6 for the permanent one)
   - **WhatsApp Business Account ID** → `WHATSAPP_BUSINESS_ACCOUNT_ID`
5. Add your own phone as a **test recipient** (API Setup page → "To" field) so you can message it during testing before going live.
6. **Get a permanent access token** (temporary ones expire in 24h and will silently break the bot):
   - Business Settings → Users → System Users → Add → create a system user with **Admin** role
   - Assign it your WhatsApp app with **full control**
   - Generate a token for that system user, scoped to `whatsapp_business_messaging` + `whatsapp_business_management`, set to **never expire**
   - This is your permanent `WHATSAPP_ACCESS_TOKEN`
7. **Get your App Secret**: App Dashboard → App Settings → Basic → App Secret (click "Show") → this is `META_APP_SECRET`.
8. **Choose a Verify Token** yourself — any string you make up, e.g. a long random password. This is `WHATSAPP_VERIFY_TOKEN`. You'll enter the *same* value in Meta's webhook config and in your Supabase secrets.
9. **Configure the webhook**: App Dashboard → WhatsApp → Configuration →
   - Callback URL: `https://nbpvamrwzqrgoiwpadwc.supabase.co/functions/v1/whatsapp-webhook`
   - Verify Token: the string you made up in step 8
   - Click **Verify and Save** — Meta will call your webhook's GET handler immediately; it only succeeds once the secrets below are set (Meta checks the token against what your function reads from `WHATSAPP_VERIFY_TOKEN`)
   - Subscribe to the **messages** webhook field
10. **Move to production**: when ready for real customers (not just your test number), submit the app for **App Review** requesting `whatsapp_business_messaging`, and complete **Business Verification**. Test-number messaging works today without this; live customer traffic needs it.

---

## 3. Set the 6 required secrets

You (or whoever has CLI/dashboard access) need to set these — I can't set secrets on your project from here, there's no tool for it. **Secrets are project-wide** — both `whatsapp-webhook` and `whatsapp-notify` read from the same pool, so you only set each one once.

**Via Supabase Dashboard:** Project Settings → Edge Functions → Secrets → Add secret, one at a time:

| Secret name | Value |
|---|---|
| `WHATSAPP_ACCESS_TOKEN` | permanent system-user token from step 6 |
| `WHATSAPP_PHONE_NUMBER_ID` | from step 4 |
| `WHATSAPP_VERIFY_TOKEN` | the string you made up in step 8 |
| `META_APP_SECRET` | from step 7 |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → `service_role` key (**secret** — never put this in frontend code; it's only safe here because it lives server-side in the Edge Function) |
| `LEAD_NOTIFY_SECRET` | `09c7e68374b2ff8895fa095e450167d8f554302f48a91916` — **use this exact value.** I generated it and already stored it in Supabase Vault as `lead_notify_secret`, which is what the database trigger sends. If you'd rather use your own value, you'd also need to update the Vault secret to match (`select vault.update_secret(...)` — ask me and I'll do it). |

`SUPABASE_URL` is already available automatically to every Edge Function — you don't need to set it.

**Via CLI**, if you have the Supabase CLI installed and linked to this project:
```bash
supabase secrets set WHATSAPP_ACCESS_TOKEN=xxxx
supabase secrets set WHATSAPP_PHONE_NUMBER_ID=xxxx
supabase secrets set WHATSAPP_VERIFY_TOKEN=xxxx
supabase secrets set META_APP_SECRET=xxxx
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=xxxx
supabase secrets set LEAD_NOTIFY_SECRET=09c7e68374b2ff8895fa095e450167d8f554302f48a91916
```

Both functions read secrets at request time, so no redeploy is needed after setting/changing them.

---

## 4. Test it

1. From your phone, send "Hi" to your Meta test number.
2. Bot should reply with the welcome message + a tappable menu (New Loan Requirement / Talk to Loan Expert / Other Query, since your test number is "new").
3. Tap **New Loan Requirement** → pick a product → answer the questions one at a time.
4. On completion, check Supabase: a new row should appear in `leads` with `stage = 'New'`, `status = 'NEW'`, and a matching `workflow_history` entry.
5. Message again from the same number later — since it's now "existing" (matches your new lead's phone), you should get the returning-customer menu with **Check Application Status**, and selecting it should show the real stage/status you just created.
6. Type **"agent"** at any point — bot should hand over and go quiet; type **"menu"** to resume.
7. Send an invalid amount (e.g. "banana") when asked for loan amount — bot should reject and re-ask, not crash.

If nothing responds at all: check Supabase Dashboard → Edge Functions → whatsapp-webhook → Logs, and Meta App Dashboard → WhatsApp → Configuration for delivery errors on the webhook.

---

## 5. Website deep-link handoff

Product pages/cards on the public site now include a "WhatsApp Us" button per product, generated by `sfmWaLinkForProduct(productName)` in `js/shared.js`. It opens WhatsApp with a prefilled message like *"Hi, I'm interested in a Home Loan."*

When that exact phrasing arrives as someone's first-ever message, `whatsapp-webhook` matches it against your active `whatsapp_products.label` values and skips straight to that product's first question — no menu, no product-selection step. This only triggers on a brand-new conversation's first message, never mid-flow, so it can't accidentally hijack an existing conversation.

If you rename a product's `label` in the database, the matching updates automatically (it reads live from `whatsapp_products`) — but make sure the website's button text (in `index.html` / `products.html`, built from `js/data.js`'s `SFM_PRODUCTS[].name`) still matches, or the deep link just falls back to the normal welcome menu instead of failing.

## 6. Managing products/questions without touching code

Right now this is done via direct SQL against `whatsapp_products` (an Admin Panel UI section for this is the natural next step — see section 7). Example, to disable a product:
```sql
update public.whatsapp_products set active = false where key = 'vehicle_loan';
```
To edit a question flow, update the `questions` jsonb array directly — each question needs `key`, `label`, `type` (`text` | `number` | `list`), and `options` if `type` is `list`. The bot re-reads this table on every message; no redeploy needed.

To add a BA assignment rule:
```sql
insert into public.whatsapp_assignment_rules (product_key, city, ba_email, priority)
values ('home_loan', 'Thane', 'someba@example.com', 10);
```

---

## 7. What this does NOT include yet

- **Admin Panel UI.** I don't have access to your `SOLITAIRE-Admin-Panel` repo's source in this session (it's private and I can't push to GitHub directly). The database and RLS are ready for a "WhatsApp Conversations" screen — it just needs a page added to your existing Admin Panel that queries `whatsapp_conversations` / `whatsapp_messages` / `lead_documents` (staff already have read access via RLS). **Paste me the relevant Admin Panel files and I'll build this next** — it's the main piece still missing.
- **Lead scoring.** Not implemented — your `leads` table doesn't have a score column today, and adding one plus scoring logic is a separate, smaller follow-up if you want it.
- **Message templates for outside the 24-hour window.** WhatsApp only allows free-form replies (including the new status-update notifications) within 24 hours of the customer's last message; anything after that requires a pre-approved template message. Both `whatsapp-webhook` and `whatsapp-notify` currently send free-form messages only — if a status change happens more than 24h after the customer's last message, WhatsApp will reject the send. Template support is a follow-up item once you've decided what templates to get approved by Meta.
- **Document previews in a UI.** Documents collected via WhatsApp are stored and tracked in `lead_documents`, but there's no screen to browse them yet — that naturally belongs in the Admin Panel screen above.

---

## 8. Suggested next steps, in order

1. Complete Meta setup (section 2) and set the 6 secrets (section 3).
2. Run the test flow (section 4) end-to-end, including sending a document during "Submit Documents" and confirming a row appears in `lead_documents` and a file in the `lead-documents` bucket.
3. Test the status-notify flow: manually update a test lead's `stage` in Supabase (or via associate-app) and confirm a WhatsApp message arrives.
4. Share your Admin Panel source so I can add the "WhatsApp Conversations" screen for real, rather than staff reading tables via SQL.
5. Decide on message templates if you want proactive (>24h) follow-ups or notifications.
