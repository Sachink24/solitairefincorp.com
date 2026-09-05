/* =========================================================
   SOLITAIRE FINZ MART — shared site config + chrome
   ========================================================= */

const SFM = {
  business: {
    name: "SOLITAIRE FINZ MART",
    phone: "8779023084",
    phoneDisplay: "+91 87790 23084",
    email: "sachinkale241981@gmail.com",
    address: "Shop No. 8, Janaram Niwas, Thane Bhiwandi Road, Thane Bhiwandi, 421302",
    hours: "Mon – Sat, 10:00 AM – 7:00 PM",
    mapsQuery: "Janaram Niwas, Thane Bhiwandi Road, Bhiwandi, 421302",
  },
  supabase: {
    url: "https://nbpvamrwzqrgoiwpadwc.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5icHZhbXJ3enFyZ29pd3BhZHdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyNTcwNDgsImV4cCI6MjEwMDgzMzA0OH0.2CQhyBhbQ7SYAXDuMqnO5qNhiIBpx4jxvDUtwyCGlpQ",
  },
  source: "solitaire-public-website",
};

function sfmWaLink(prefilledText) {
  const digits = "91" + SFM.business.phone;
  const text = encodeURIComponent(prefilledText || "Hello SOLITAIRE FINZ MART, I'd like to enquire about a loan.");
  return `https://wa.me/${digits}?text=${text}`;
}
function sfmTelLink(){ return `tel:${SFM.business.phone}`; }
function sfmMailLink(subject){ return `mailto:${SFM.business.email}${subject ? "?subject=" + encodeURIComponent(subject) : ""}`; }
function sfmMapsLink(){ return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(SFM.business.mapsQuery)}`; }
function sfmFormatINR(n){
  if (n === null || n === undefined || isNaN(n)) return "₹0";
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

let _sb = null;
function sfmSupabase(){
  if (_sb) return _sb;
  if (typeof window.supabase === "undefined") return null;
  _sb = window.supabase.createClient(SFM.supabase.url, SFM.supabase.anonKey);
  return _sb;
}

/* Save a lead into public.website_enquiries. Field names map 1:1 to the
   existing production table shared with the Admin Panel / associate-app. */
async function sfmSaveEnquiry(payload) {
  const client = sfmSupabase();
  const record = Object.assign({
    source: SFM.source,
    page_url: window.location.href,
  }, payload);
  if (!client) {
    console.warn("Supabase client unavailable — enquiry not saved", record);
    throw new Error("offline");
  }
  const { error } = await client.from("website_enquiries").insert(record);
  if (error) throw error;
  return true;
}

/* ---------------- header / footer ---------------- */
const SFM_NAV = [
  ["index.html", "Home"],
  ["about.html", "About Us"],
  ["products.html", "Loan Products"],
  ["services.html", "Services"],
  ["eligibility.html", "Eligibility"],
  ["emi-calculator.html", "EMI Calculator"],
  ["blog.html", "Knowledge Center"],
  ["contact.html", "Contact"],
];

function sfmRenderHeader(active) {
  const el = document.getElementById("site-header");
  if (!el) return;

  // slim utility bar above the main header — carries contact info + Apply CTA
  // that used to live in the header itself, so the logo area stays clean.
  let topbar = document.getElementById("site-topbar");
  if (!topbar) {
    topbar = document.createElement("div");
    topbar.id = "site-topbar";
    topbar.className = "site-topbar";
    el.parentNode.insertBefore(topbar, el);
  }
  topbar.innerHTML = `
  <div class="container">
    <div class="topbar-links">
      <a href="${sfmTelLink()}">📞 ${SFM.business.phoneDisplay}</a>
      <a class="tb-email" href="${sfmMailLink()}">${SFM.business.email}</a>
      <a class="tb-address" href="${sfmMapsLink()}" target="_blank" rel="noopener">${SFM.business.address.split(",")[0]}, Thane Bhiwandi</a>
    </div>
    <a class="topbar-cta" href="application.html">Apply for a Loan</a>
  </div>`;

  const links = SFM_NAV.map(([href, label]) =>
    `<a href="${href}" ${active === href ? 'aria-current="page"' : ""}>${label}</a>`
  ).join("");
  el.innerHTML = `
  <div class="container">
    <a href="index.html" class="wordmark" aria-label="SOLITAIRE FINZ MART — Home">
      <svg class="diamond-mark" width="32" height="32" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M8 14L20 4L32 14L20 36L8 14Z" stroke="#D8B45C" stroke-width="1.4" stroke-linejoin="round"/>
        <path d="M8 14H32" stroke="#D8B45C" stroke-width="1.1"/>
        <path d="M14.5 14L20 4L25.5 14" stroke="#D8B45C" stroke-width="1"/>
        <path d="M14.5 14L20 36L25.5 14" stroke="#D8B45C" stroke-width="1"/>
      </svg>
      <span class="wm-text">
        <span class="wm-main">SOLITAIRE<span class="wm-sub-inline">Finz Mart</span></span>
        <small class="wm-slogan">Trusted Lending · Transparent Guidance</small>
      </span>
    </a>
    <nav class="nav-main" id="nav-main">${links}</nav>
    <button class="nav-toggle" id="nav-toggle" aria-label="Menu" aria-expanded="false"><span></span></button>
  </div>`;
  const toggle = document.getElementById("nav-toggle");
  const nav = document.getElementById("nav-main");
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(open));
  });
  nav.querySelectorAll("a").forEach(a => a.addEventListener("click", () => {
    nav.classList.remove("is-open"); toggle.setAttribute("aria-expanded", "false");
  }));
}

function sfmRenderFooter() {
  const el = document.getElementById("site-footer");
  if (!el) return;
  const y = new Date().getFullYear();
  el.innerHTML = `
  <div class="container">
    <div class="footer-grid">
      <div>
        <div class="wordmark" style="color:var(--text-on-ink); margin-bottom:1rem;">SOLITAIRE FINZ MART</div>
        <p style="max-width:32ch; font-size:.9rem;">Loan and financial advisory services in Thane–Bhiwandi, connecting borrowers with banks and NBFCs across home loans, business finance and property finance.</p>
        <div class="btn-row" style="margin-top:1.2rem;">
          <a class="btn btn-outline btn-sm" href="${sfmWaLink()}" target="_blank" rel="noopener">WhatsApp Us</a>
        </div>
      </div>
      <div>
        <h4>Loan Products</h4>
        <ul>
          <li><a href="products.html#home-loan">Home Loan</a></li>
          <li><a href="products.html#loan-against-property">Loan Against Property</a></li>
          <li><a href="products.html#business-loan">Business Loan</a></li>
          <li><a href="products.html#balance-transfer">Balance Transfer</a></li>
          <li><a href="products.html">View all products</a></li>
        </ul>
      </div>
      <div>
        <h4>Company</h4>
        <ul>
          <li><a href="about.html">About Us</a></li>
          <li><a href="services.html">Services</a></li>
          <li><a href="eligibility.html">Eligibility Checker</a></li>
          <li><a href="emi-calculator.html">EMI Calculator</a></li>
          <li><a href="blog.html">Knowledge Center</a></li>
        </ul>
      </div>
      <div>
        <h4>Reach Us</h4>
        <ul>
          <li><a href="${sfmTelLink()}">${SFM.business.phoneDisplay}</a></li>
          <li><a href="${sfmMailLink()}">${SFM.business.email}</a></li>
          <li>${SFM.business.address}</li>
          <li>${SFM.business.hours}</li>
        </ul>
      </div>
    </div>
    <hr class="rule" />
    <div class="footer-bottom">
      <span>© ${y} Solitaire Finz Mart. All rights reserved.</span>
      <span>
        <a href="privacy-policy.html">Privacy Policy</a>
        <a href="terms.html">Terms</a>
        <a href="disclaimer.html">Disclaimer</a>
      </span>
    </div>
  </div>`;
}

function sfmRenderWaFloat(){
  const el = document.getElementById("wa-float");
  if (!el) return;
  el.innerHTML = `<a class="wa-float" href="${sfmWaLink()}" target="_blank" rel="noopener" aria-label="Chat on WhatsApp">
    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.7-.8-1.9-.9-.3-.1-.4-.1-.6.1-.2.3-.7.9-.8 1-.2.2-.3.2-.5.1-.3-.1-1.2-.4-2.2-1.4-.8-.7-1.4-1.6-1.5-1.9-.2-.3 0-.4.1-.6.1-.1.3-.3.4-.5.1-.1.2-.3.2-.4.1-.2 0-.4 0-.5C10.6 9 10.1 7.8 10 7.4c-.2-.4-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.3-1 1-1 2.3 0 1.4 1 2.7 1.1 2.9.1.2 2 3 4.7 4.2.7.3 1.2.5 1.6.6.7.2 1.3.2 1.7.1.5-.1 1.7-.7 1.9-1.3.2-.7.2-1.2.2-1.3-.1-.2-.3-.3-.5-.4z"/><path d="M12 2C6.5 2 2 6.5 2 12c0 1.9.5 3.7 1.5 5.3L2 22l4.9-1.3c1.5.8 3.2 1.3 5.1 1.3 5.5 0 10-4.5 10-10S17.5 2 12 2zm0 18.3c-1.7 0-3.3-.5-4.7-1.3l-.3-.2-3.4.9.9-3.3-.2-.3C3.5 14.7 3 13 3 12c0-5 4-9 9-9s9 4 9 9-4 9-9 9z"/></svg>
  </a>`;
}

/* ---------------- animated counters ---------------- */
function sfmAnimateCounters(root = document) {
  const els = root.querySelectorAll("[data-count]");
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const target = parseFloat(el.dataset.count);
      const suffix = el.dataset.suffix || "";
      const dur = 1200; let start = null;
      function step(ts){
        if (!start) start = ts;
        const p = Math.min((ts - start) / dur, 1);
        el.textContent = Math.floor(p * target).toLocaleString("en-IN") + suffix;
        if (p < 1) requestAnimationFrame(step);
        else el.textContent = target.toLocaleString("en-IN") + suffix;
      }
      requestAnimationFrame(step);
      io.unobserve(el);
    });
  }, { threshold: 0.4 });
  els.forEach(el => io.observe(el));
}

/* ---------------- accordion (FAQ) ---------------- */
function sfmInitAccordion(container) {
  container.querySelectorAll(".accordion-item").forEach(item => {
    const btn = item.querySelector("button");
    const panel = item.querySelector(".accordion-panel");
    btn.addEventListener("click", () => {
      const open = item.getAttribute("data-open") === "true";
      container.querySelectorAll(".accordion-item").forEach(i => { i.setAttribute("data-open","false"); i.querySelector(".accordion-panel").style.maxHeight = null; });
      if (!open) { item.setAttribute("data-open","true"); panel.style.maxHeight = panel.scrollHeight + "px"; }
    });
  });
}

/* ---------------- scroll-reveal animation ---------------- */
function sfmInitReveal() {
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const selector = ".card, .section-head, .step, .tl-item, .testi-card, .stat, .accordion-item, .hero-grid > *";
  const els = Array.from(document.querySelectorAll(selector));
  if (prefersReduced || !els.length) return;
  els.forEach((el, i) => {
    el.classList.add("reveal");
    el.style.transitionDelay = (Math.min(i % 4, 3) * 0.08) + "s";
  });
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add("is-visible"); io.unobserve(entry.target); }
    });
  }, { threshold: 0.15 });
  els.forEach(el => io.observe(el));
}

document.addEventListener("DOMContentLoaded", () => {
  sfmRenderHeader(document.body.dataset.page);
  sfmRenderFooter();
  sfmRenderWaFloat();
  sfmAnimateCounters();
  sfmInitReveal();
});
