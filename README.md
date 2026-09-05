# Solitaire Finz Mart — Public Website

A static, production-ready public marketing site for SOLITAIRE FINZ MART: vanilla HTML/CSS/JS,
no build step, deployable directly to GitHub Pages — matching the pattern of your other repos
(`associate-app`, `SOLITAIRE-Admin-Panel`).

## What's included

- **Home, About, Loan Products (11 categories), Services, EMI Calculator, Eligibility Checker,
  Loan Application form, Contact, Knowledge Center (blog) with 3 articles, Privacy Policy,
  Terms, Disclaimer, 404.**
- Fully working `tel:`, `mailto:` and WhatsApp (`wa.me`) links throughout.
- A working EMI calculator (reducing-balance formula) with a principal/interest visual bar.
- An interactive, multi-step eligibility checker producing an indicative estimate (clearly
  labelled as indicative, per your compliance requirement) and capturing the lead.
- Every form (contact, application, eligibility) writes directly into your **existing**
  `public.website_enquiries` table in the `nbpvamrwzqrgoiwpadwc` Supabase project — the same
  table your Admin Panel / associate-app already read from. No new tables or migrations were
  created. `anon` insert access on that table was already open (`public_can_insert_enquiries`
  policy), so no RLS changes were needed either.
- SEO: per-page meta/OG tags, `sitemap.xml`, `robots.txt`, Organization + Article JSON-LD.
- Design system: "Ledger & Gold" — a deep-ink/warm-paper palette with a bronze-gold accent,
  Cormorant Garamond for display type, Inter for body/UI, Cinzel reserved for the wordmark only.
  Tokens live at the top of `css/style.css`.

## What was deliberately left out of this pass

The full master prompt also asked for: customer login/dashboard with application-status
tracking, a staff/admin CMS for products/partners/testimonials/FAQs/blog, document upload,
and role-based auth. Building genuine, secure versions of those is a much larger project on
its own — and you already run `SOLITAIRE-Admin-Panel` and `associate-app` against this same
Supabase project for internal case management. Rather than build a second, disconnected admin
system, the recommended next step is:

1. Decide whether `website_enquiries` rows should be triaged inside the existing Admin Panel
   (it already has read access via `staff_can_view_enquiries`) or need a small dedicated view.
2. If you want the **Loan Products / Partners / Testimonials / FAQ / Blog** content to be
   admin-editable rather than living in `js/data.js`, we can wire those to Supabase tables next
   — `loan_products` already exists but only has `name/category/description/active`; it would
   need a few more columns (amount range, rate, tenure, eligibility, documents, benefits,
   process) to match what this site displays. I didn't alter that table without your sign-off.
3. A customer login/status-tracker would reuse `public.users` auth, similar to the Admin Panel's
   `signInWithPassword` pattern.

## Content flagged as placeholder

Per your instruction not to invent real business facts, the following are clearly marked as
illustrative in the page copy itself and should be replaced with verified data:
- Company statistics (years/customers/applications — years of experience is set to 15 based on
  your memory context; the others are placeholders)
- Lending partner list (the 8 names from your business context are shown, but logos/descriptions
  are generic — replace once you confirm what can be publicly disclosed)
- Testimonials (demo content)
- Interest rates / loan amount ranges per product (marked with `*` and a disclaimer)
- Company timeline dates in About Us

## Local preview

No build step — open `index.html` directly in a browser, or serve the folder with any static
server, e.g. `npx serve .` from within this folder.

## Deploy to GitHub Pages

```bash
# from inside this folder
git init
git add .
git commit -m "Initial public website"
git branch -M main
git remote add origin https://github.com/Sachink24/solitaire-website.git
git push -u origin main
```
Then in the repo settings, enable GitHub Pages for the `main` branch, root folder.
Update `sitemap.xml` and `robots.txt` if you deploy under a different repo name.

## Supabase

Uses the project's existing public anon key (safe to expose client-side — this is exactly what
anon keys are for, and access is governed by the RLS policies already on the table). No new
environment variables or secrets are needed since there's no backend server component.
