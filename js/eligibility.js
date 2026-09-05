const SFM_ELIG_STEPS = [
  {
    key: "product", type: "choice", question: "What would you like the loan for?",
    options: ["Home Loan", "Business Loan", "Personal Loan", "Loan Against Property", "Other"],
  },
  {
    key: "employment", type: "choice", question: "What best describes your employment?",
    options: ["Salaried", "Self-employed business", "Self-employed professional"],
  },
  {
    key: "income", type: "choice", question: "What is your approximate monthly income (after business expenses, if applicable)?",
    options: ["Below ₹25,000", "₹25,000 – ₹50,000", "₹50,000 – ₹1,00,000", "Above ₹1,00,000"],
    values: [20000, 37500, 75000, 150000],
  },
  {
    key: "existingEmi", type: "choice", question: "Do you currently pay EMIs on any other loans?",
    options: ["None", "Up to ₹10,000 / month", "₹10,000 – ₹25,000 / month", "Above ₹25,000 / month"],
    values: [0, 5000, 17500, 30000],
  },
  {
    key: "amount", type: "input", question: "What loan amount are you looking for? (approximate, in ₹)",
    placeholder: "e.g. 2500000",
  },
  {
    key: "contact", type: "contact", question: "Almost there — where should we send your indicative result?",
  },
];

function sfmInitEligibilityQuiz(root) {
  let step = 0;
  const answers = {};
  const progressBar = root.querySelector(".quiz-progress .bar");
  const body = root.querySelector("[data-quiz-body]");

  function updateProgress() {
    const pct = (step / SFM_ELIG_STEPS.length) * 100;
    progressBar.style.width = pct + "%";
  }

  function renderStep() {
    updateProgress();
    if (step >= SFM_ELIG_STEPS.length) { computeAndShowResult(); return; }
    const s = SFM_ELIG_STEPS[step];
    let html = `<h3 style="margin-bottom:1.4rem;">${s.question}</h3>`;

    if (s.type === "choice") {
      html += `<div class="quiz-options" data-choice-group>` +
        s.options.map((opt, i) => `<button type="button" data-value="${s.values ? s.values[i] : opt}" data-label="${opt}">${opt}</button>`).join("") +
        `</div>`;
    } else if (s.type === "input") {
      html += `<div class="field" style="margin-bottom:1.6rem;"><input type="number" min="0" step="10000" placeholder="${s.placeholder}" data-quiz-input /></div>
        <button class="btn btn-primary" data-quiz-next>Continue</button>`;
    } else if (s.type === "contact") {
      html += `
        <div class="form-grid" style="margin-bottom:1.2rem;">
          <div class="field full"><label>Full Name</label><input type="text" data-c-name /></div>
          <div class="field"><label>Mobile Number</label><input type="tel" data-c-mobile /></div>
          <div class="field"><label>Email (optional)</label><input type="email" data-c-email /></div>
          <div class="field full"><label>City</label><input type="text" data-c-city /></div>
        </div>
        <button class="btn btn-primary" data-quiz-next>See My Indicative Eligibility</button>`;
    }
    body.innerHTML = html;

    if (s.type === "choice") {
      body.querySelectorAll("[data-choice-group] button").forEach(btn => {
        btn.addEventListener("click", () => {
          answers[s.key] = { value: Number(btn.dataset.value) || btn.dataset.value, label: btn.dataset.label };
          step++; renderStep();
        });
      });
    } else {
      body.querySelector("[data-quiz-next]").addEventListener("click", () => {
        if (s.type === "input") {
          const val = Number(body.querySelector("[data-quiz-input]").value);
          if (!val) { return; }
          answers.amount = { value: val, label: sfmFormatINR(val) };
        } else if (s.type === "contact") {
          const name = body.querySelector("[data-c-name]").value.trim();
          const mobile = body.querySelector("[data-c-mobile]").value.trim();
          if (!name || !mobile) return;
          answers.contact = {
            name, mobile,
            email: body.querySelector("[data-c-email]").value.trim(),
            city: body.querySelector("[data-c-city]").value.trim(),
          };
        }
        step++; renderStep();
      });
    }
  }

  async function computeAndShowResult() {
    const income = answers.income ? answers.income.value : 30000;
    const existingEmi = answers.existingEmi ? answers.existingEmi.value : 0;
    const requestedAmount = answers.amount ? answers.amount.value : 0;

    // Indicative FOIR-based estimate: assume lenders allow total obligations
    // up to ~50% of monthly income; subtract existing EMI to find headroom,
    // then back-solve an eligible loan amount at an illustrative rate/tenure.
    const maxAllowedEmi = Math.max(income * 0.5 - existingEmi, 0);
    const illustrativeRate = 9.5;
    const illustrativeTenureYears = answers.product && answers.product.label === "Personal Loan" ? 5 : 15;
    const r = illustrativeRate / 12 / 100;
    const n = illustrativeTenureYears * 12;
    const factor = Math.pow(1 + r, n);
    const eligibleAmount = maxAllowedEmi > 0 ? (maxAllowedEmi * (factor - 1)) / (r * factor) : 0;

    const result = {
      product: answers.product?.label,
      requested_amount: requestedAmount,
      indicative_eligible_amount: Math.round(eligibleAmount),
      indicative_emi: Math.round(maxAllowedEmi),
      assumed_rate_pct: illustrativeRate,
      assumed_tenure_years: illustrativeTenureYears,
      monthly_income_band: answers.income?.label,
      existing_emi_band: answers.existingEmi?.label,
      employment: answers.employment?.label,
    };

    body.innerHTML = `
      <div class="quiz-result">
        <p class="kicker" style="margin-bottom:.4rem;">Indicative result</p>
        <h3 style="font-size:1.9rem;">${sfmFormatINR(result.indicative_eligible_amount)}</h3>
        <p style="color:var(--text-muted); margin-bottom:1.4rem;">estimated eligible loan amount for ${result.product || "your requirement"}, based on the details you shared.</p>
        <div class="ledger-row" style="border-color:var(--line-on-paper);"><span>You requested</span><span>${sfmFormatINR(result.requested_amount)}</span></div>
        <div class="ledger-row" style="border-color:var(--line-on-paper);"><span>Assumed EMI capacity</span><span>${sfmFormatINR(result.indicative_emi)}/mo</span></div>
        <div class="ledger-row" style="border-color:var(--line-on-paper);"><span>Illustrative rate / tenure</span><span>${result.assumed_rate_pct}% · ${result.assumed_tenure_years} yrs</span></div>
        <p style="font-size:.82rem; color:var(--text-muted); margin-top:1.4rem;">This is an indicative eligibility assessment only. Final eligibility, interest rate and approval are subject to the policies, verification and approval of the respective lending institution.</p>
        <div class="btn-row" style="margin-top:1.4rem;">
          <a class="btn btn-primary" href="application.html">Apply for This Loan</a>
          <a class="btn btn-outline" href="${sfmTelLink()}">Call ${SFM.business.phoneDisplay}</a>
        </div>
      </div>`;

    try {
      await sfmSaveEnquiry({
        enquiry_type: "eligibility_check",
        full_name: answers.contact.name,
        mobile: answers.contact.mobile,
        email: answers.contact.email || null,
        city: answers.contact.city || null,
        product_interest: result.product || null,
        funding_requirement: result.requested_amount || null,
        eligibility_result: result,
      });
    } catch (err) {
      console.warn("Eligibility lead not saved", err);
    }
  }

  renderStep();
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-eligibility-quiz]").forEach(sfmInitEligibilityQuiz);
});
