/* =========================================================
   Demo / placeholder content. Clearly marked as illustrative —
   swap for live values from the Admin Panel once available.
   Interest rates and ranges are indicative starting points only.
   ========================================================= */

const SFM_STATS = [
  { num: 15, suffix: "+", label: "Years of experience" },
  { num: 1200, suffix: "+", label: "Customers assisted*" },
  { num: 2600, suffix: "+", label: "Applications processed*" },
  { num: 8, suffix: "", label: "Bank & NBFC partners" },
  { num: 10, suffix: "+", label: "Loan categories" },
];

const SFM_PRODUCTS = [
  {
    slug: "home-loan", name: "Home Loan", icon: "home", short: "Buy, build or renovate your home with structured, long-tenure financing.",
    amount: "₹5 Lakh – ₹5 Crore*", rate: "Starting from 8.35%* p.a.", tenure: "Up to 30 years",
    eligibility: ["Salaried or self-employed applicants", "Age 21–65 years at loan maturity", "Stable income with acceptable credit history", "Clear title on the property being financed"],
    documents: ["PAN & Aadhaar", "Income proof (salary slips / ITR)", "Bank statements (last 6 months)", "Property documents", "Passport-size photographs"],
    benefits: ["Structured EMI options", "Assistance across multiple lenders", "Guidance on tax-saving components", "Support with property document verification"],
    process: ["Share your requirement", "Eligibility assessment", "Lender shortlisting", "Documentation", "Sanction & disbursement"],
  },
  {
    slug: "loan-against-property", name: "Loan Against Property", icon: "building", short: "Unlock funds against residential or commercial property you already own.",
    amount: "₹10 Lakh – ₹10 Crore*", rate: "Starting from 9.25%* p.a.", tenure: "Up to 15 years",
    eligibility: ["Clear, marketable property title", "Salaried or self-employed applicants", "Existing loans considered against repayment capacity"],
    documents: ["PAN & Aadhaar", "Property title documents", "Income proof", "Bank statements (last 6–12 months)"],
    benefits: ["Larger ticket sizes than unsecured loans", "Flexible end-use of funds", "Longer repayment tenure"],
    process: ["Share property & income details", "Property & legal verification", "Lender matching", "Documentation", "Sanction & disbursement"],
  },
  {
    slug: "personal-loan", name: "Personal Loan", icon: "user", short: "Unsecured financing for personal needs, approved quickly with minimal paperwork.",
    amount: "₹50,000 – ₹25 Lakh*", rate: "Starting from 10.5%* p.a.", tenure: "Up to 5 years",
    eligibility: ["Salaried with stable monthly income", "Minimum credit score as per lender policy", "Age 21–60 years"],
    documents: ["PAN & Aadhaar", "Latest salary slips", "Bank statements (last 3 months)"],
    benefits: ["No collateral required", "Fast turnaround", "Flexible usage — medical, travel, wedding, education"],
    process: ["Share requirement", "Quick eligibility check", "Documentation", "Sanction & disbursement"],
  },
  {
    slug: "business-loan", name: "Business Loan", icon: "briefcase", short: "Working capital and growth capital for proprietorships, partnerships and companies.",
    amount: "₹1 Lakh – ₹5 Crore*", rate: "Starting from 11%* p.a.", tenure: "Up to 7 years",
    eligibility: ["Business vintage as per lender policy (typically 2+ years)", "Healthy banking and ITR track record", "Proprietorship, partnership, LLP or Pvt Ltd"],
    documents: ["PAN & Aadhaar", "Business registration proof", "ITR & financial statements (2–3 years)", "Bank statements (last 12 months)", "GST returns where applicable"],
    benefits: ["Term loan & working capital structures", "Assistance with financial statement preparation", "Multiple lender options compared side by side"],
    process: ["Discuss business requirement", "Financial document review", "Lender shortlisting", "Documentation", "Sanction & disbursement"],
  },
  {
    slug: "msme-loan", name: "MSME Loan", icon: "cog", short: "Collateral-friendly financing designed for registered micro, small and medium enterprises.",
    amount: "₹1 Lakh – ₹2 Crore*", rate: "Starting from 10.75%* p.a.", tenure: "Up to 7 years",
    eligibility: ["Udyam / MSME registration", "Business vintage as per lender policy", "Satisfactory banking conduct"],
    documents: ["Udyam registration certificate", "PAN & Aadhaar", "ITR & GST returns", "Bank statements"],
    benefits: ["Schemes tailored for small enterprises", "Support with Udyam registration guidance", "Assistance with scheme-linked interest benefits where applicable"],
    process: ["Share business profile", "Scheme matching", "Documentation", "Sanction & disbursement"],
  },
  {
    slug: "working-capital", name: "Working Capital Loan", icon: "refresh", short: "Cash-credit and overdraft limits to smooth day-to-day business operations.",
    amount: "₹5 Lakh – ₹5 Crore*", rate: "Starting from 10.5%* p.a.", tenure: "Renewable annually",
    eligibility: ["Established business with trading/manufacturing operations", "Acceptable stock & receivables cycle", "Satisfactory banking conduct"],
    documents: ["Financial statements", "Stock & receivables statements", "Bank statements", "GST returns"],
    benefits: ["Drawing power linked to stock & book debts", "Renewable facility", "Helps manage seasonal cash-flow gaps"],
    process: ["Share business & cash-flow details", "Limit assessment", "Documentation", "Sanction & renewal cycle setup"],
  },
  {
    slug: "commercial-property-loan", name: "Commercial Property Loan", icon: "building", short: "Finance for purchase or construction of office, retail or industrial space.",
    amount: "₹10 Lakh – ₹10 Crore*", rate: "Starting from 9.75%* p.a.", tenure: "Up to 15 years",
    eligibility: ["Clear commercial property title", "Acceptable income / business profile", "Property use as per approved zoning"],
    documents: ["Property documents & approvals", "Income / business proof", "Bank statements"],
    benefits: ["Financing for ready or under-construction commercial units", "Support with legal & technical due diligence"],
    process: ["Share property & requirement details", "Legal & technical assessment", "Documentation", "Sanction & disbursement"],
  },
  {
    slug: "project-construction-finance", name: "Project / Construction Finance", icon: "layers", short: "Structured funding for builders and developers across project stages.",
    amount: "₹50 Lakh – ₹25 Crore*", rate: "As per project assessment*", tenure: "As per project timeline",
    eligibility: ["Approved project plans / RERA registration where applicable", "Promoter contribution as per lender norms", "Track record of promoters"],
    documents: ["Project approvals & plans", "Land / TDR documents", "Promoter financials", "Project cost & funding breakdown"],
    benefits: ["Stage-wise disbursement structuring", "Assistance with lender & document coordination", "Guidance through legal and technical evaluation"],
    process: ["Share project details", "Legal & technical evaluation", "Lender matching", "Documentation", "Stage-wise sanction & disbursement"],
  },
  {
    slug: "machinery-equipment-finance", name: "Machinery / Equipment Finance", icon: "wrench", short: "Finance for purchase of new or used machinery and equipment.",
    amount: "₹1 Lakh – ₹3 Crore*", rate: "Starting from 11.5%* p.a.", tenure: "Up to 7 years",
    eligibility: ["Existing or new business use-case", "Acceptable business / income profile", "Quotation from recognised supplier"],
    documents: ["Machinery quotation / proforma invoice", "PAN & Aadhaar", "Business & income proof"],
    benefits: ["Financing tied to asset value", "Assistance comparing vendor-tied and open-market financing"],
    process: ["Share equipment quotation", "Eligibility check", "Documentation", "Sanction & disbursement"],
  },
  {
    slug: "vehicle-loan", name: "Vehicle Loan", icon: "truck", short: "Financing for personal or commercial vehicle purchase.",
    amount: "₹1 Lakh – ₹50 Lakh*", rate: "Starting from 9%* p.a.", tenure: "Up to 7 years",
    eligibility: ["Valid driving license / RC as applicable", "Stable income", "Age 21–65 years"],
    documents: ["PAN & Aadhaar", "Income proof", "Vehicle quotation / proforma invoice"],
    benefits: ["New and used vehicle options", "Flexible tenure choices"],
    process: ["Share vehicle & income details", "Eligibility check", "Documentation", "Sanction & disbursement"],
  },
  {
    slug: "balance-transfer", name: "Balance Transfer", icon: "exchange", short: "Move your existing loan to a lender offering better terms, and unlock a top-up if eligible.",
    amount: "As per outstanding loan*", rate: "Starting from 8.35%* p.a.", tenure: "Remaining original tenure or higher",
    eligibility: ["Satisfactory repayment track record on the existing loan", "Property / asset in good standing", "Acceptable income profile"],
    documents: ["Existing loan statement / foreclosure letter", "Property documents", "Income proof"],
    benefits: ["Potential to reduce interest outgo", "Option to add a top-up loan", "Assistance managing the transfer paperwork end-to-end"],
    process: ["Share existing loan details", "Rate & savings comparison", "Documentation", "New sanction & transfer"],
  },
  {
    slug: "loan-top-up", name: "Loan Top-Up", icon: "trending-up", short: "Access additional funds over your existing home loan or LAP, without a fresh full application.",
    amount: "As per eligibility and existing loan*", rate: "Linked to base loan rate*", tenure: "Aligned to base loan",
    eligibility: ["Existing loan in good standing", "Sufficient repayment track record", "Property value supporting the top-up"],
    documents: ["Existing loan statement", "Income proof", "Property documents (if required)"],
    benefits: ["Faster processing than a fresh loan", "Competitive rate linked to existing facility"],
    process: ["Share existing loan details", "Eligibility check", "Documentation", "Sanction & disbursement"],
  },
];

const SFM_SERVICES = [
  { title: "Loan Advisory", icon: "handshake", desc: "One-to-one guidance to understand which loan product and lender best fit your requirement, income profile and timeline.", benefits: ["Unbiased comparison across lenders", "Clarity on real, all-in cost of borrowing"], process: ["Discuss your requirement", "Review your financial profile", "Present suitable options"] },
  { title: "Loan Eligibility Assessment", icon: "badge-percent", desc: "A practical read on how much you're likely to be able to borrow, before you formally apply anywhere.", benefits: ["Saves time on applications unlikely to be approved", "Identifies what to fix before applying"], process: ["Share income & obligation details", "Assessment against lender norms", "Indicative eligibility shared"] },
  { title: "Documentation Assistance", icon: "layers", desc: "Help assembling, organising and presenting the paperwork lenders expect — the single biggest cause of delay.", benefits: ["Fewer back-and-forth document requests", "Faster file movement at the lender"], process: ["Document checklist shared", "Collection & review", "Submission-ready file prepared"] },
  { title: "Lending Partner Selection", icon: "link", desc: "Matching your requirement against our panel of banks and NBFCs to find a workable fit on rate, tenure and turnaround.", benefits: ["Access to multiple lender options", "Realistic view of approval likelihood"], process: ["Requirement mapping", "Shortlist of 2–3 lenders", "Parallel application support"] },
  { title: "Application Assistance", icon: "briefcase", desc: "End-to-end support from form-filling through to sanction, so you're not navigating the process alone.", benefits: ["Single point of contact throughout", "Regular status updates"], process: ["Application filing", "Follow-up with lender", "Status updates until sanction"] },
  { title: "Balance Transfer Assistance", icon: "exchange", desc: "Evaluating whether moving your existing loan to another lender genuinely saves money, and managing the switch.", benefits: ["Clear savings calculation before you commit", "Paperwork coordination with both lenders"], process: ["Existing loan review", "Savings comparison", "Transfer documentation & closure coordination"] },
  { title: "Business Finance Assistance", icon: "chart", desc: "Working capital and term-loan structuring support for proprietorships, partnerships and companies.", benefits: ["Financial statement guidance", "Structuring across term loan / OD / CC as needed"], process: ["Business & financial review", "Structure recommendation", "Lender coordination"] },
  { title: "Property Finance Assistance", icon: "building", desc: "Support across home loans, LAP and commercial property finance, including basic document checks.", benefits: ["Coordination with legal & technical evaluators", "Guidance on property document requirements"], process: ["Property & requirement review", "Legal/technical coordination", "Lender submission"] },
  { title: "End-to-End Loan Support", icon: "shield-check", desc: "From first conversation to disbursement, a single team managing documentation, lender coordination and follow-up.", benefits: ["Reduced running-around between offices", "Consistent point of contact"], process: ["Requirement discussion", "Documentation & lender coordination", "Sanction through disbursement"] },
];

const SFM_PARTNERS = [
  { name: "ICICI Bank", categories: "Home Loan, LAP, Business Loan" },
  { name: "Axis Bank", categories: "Home Loan, Personal Loan, Business Loan" },
  { name: "State Bank of India", categories: "Home Loan, MSME, Working Capital" },
  { name: "HDFC Bank", categories: "Home Loan, LAP, Balance Transfer" },
  { name: "Punjab National Bank", categories: "Home Loan, MSME" },
  { name: "Piramal Finance", categories: "LAP, Business Loan" },
  { name: "Tata Capital", categories: "Personal Loan, Business Loan, LAP" },
  { name: "IIFL Finance", categories: "Business Loan, LAP, MSME" },
];

const SFM_TESTIMONIALS = [
  { quote: "Solitaire Finz Mart walked us through every step of our home loan and kept us informed at every stage.", name: "Demo Testimonial", role: "Home Loan customer" },
  { quote: "Our business loan paperwork was sorted out faster than we expected, with clear guidance throughout.", name: "Demo Testimonial", role: "Business Loan customer" },
  { quote: "The balance transfer process was explained clearly, and the savings on our EMI were exactly as projected.", name: "Demo Testimonial", role: "Balance Transfer customer" },
];

const SFM_FAQS = [
  { q: "How do I know which loan product suits my requirement?", a: "Share your requirement — purpose, amount and timeline — through our enquiry form or a quick call, and our team will guide you toward the most suitable product and lender based on your income profile." },
  { q: "Is my loan approval guaranteed?", a: "No. All loans are subject to the credit policy, verification and final approval of the respective bank or NBFC. We assist with documentation and lender matching, but approval and final terms rest with the lending institution." },
  { q: "What documents will I generally need?", a: "Typically PAN, Aadhaar, income proof (salary slips or ITR), bank statements, and property or business documents where relevant. Exact requirements vary by loan type and lender — see each product page for a detailed checklist." },
  { q: "How long does loan processing usually take?", a: "Timelines vary by loan type, lender and how quickly documentation is completed. Personal loans and pre-approved offers can move faster; property-backed and business loans typically involve additional verification steps." },
  { q: "Do you charge the customer directly for your services?", a: "Our services are structured around assisting you through the loan process end-to-end. Any applicable charges will be clearly communicated to you upfront before you proceed." },
  { q: "Can I transfer my existing loan to get a better rate?", a: "In many cases, yes. We assess your existing loan against current market offers and only recommend a balance transfer if it genuinely works out in your favour after accounting for transfer costs." },
];

const SFM_TIMELINE = [
  { year: "Founded", title: "Solitaire Finz Mart established", text: "Began as a local loan and financial advisory practice serving the Bhiwandi–Thane region." },
  { year: "Early growth", title: "Building trust, one file at a time", text: "Grew primarily through referrals, focusing on transparent guidance for home and business loan customers." },
  { year: "Expansion", title: "Widening the product range", text: "Added property finance, MSME and working capital advisory alongside core home and personal loan services." },
  { year: "Partnerships", title: "Growing our lending partner network", text: "Built working relationships with multiple banks and NBFCs to offer customers a genuine choice of lenders." },
  { year: "Technology", title: "Digitising our internal operations", text: "Moved case tracking, underwriting coordination and document workflows onto an internal digital platform for faster, more transparent processing." },
  { year: "Today", title: "Present operations", text: "Fifteen-plus years into operation, continuing to serve individuals and businesses across home loans, business finance and project finance." },
];

const SFM_BLOG_POSTS = [
  { slug: "home-loan-guide", category: "Home Loans", title: "A First-Time Applicant's Guide to Home Loans in India", date: "2026-06-12", excerpt: "What lenders actually look at, which documents to keep ready, and how to avoid the delays that catch most first-time applicants off guard.", file: "blog-home-loan-guide.html" },
  { slug: "business-loan-documents", category: "Business Loans", title: "The Business Loan Document Checklist Most Applicants Get Wrong", date: "2026-05-28", excerpt: "Beyond PAN and ITR — the financial statement details and banking-conduct signals that actually influence a business loan decision.", file: "blog-business-loan-documents.html" },
  { slug: "cibil-score-guide", category: "Credit & CIBIL", title: "Understanding Your CIBIL Score Before You Apply", date: "2026-05-05", excerpt: "What actually moves your credit score, how lenders read it, and practical steps to improve it before your next loan application.", file: "blog-cibil-score-guide.html" },
];
