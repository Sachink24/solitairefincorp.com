function sfmComputeEMI(principal, annualRatePct, tenureYears) {
  const r = annualRatePct / 12 / 100;
  const n = tenureYears * 12;
  if (r === 0) {
    const emi = principal / n;
    return { emi, totalInterest: 0, totalPayment: principal };
  }
  const factor = Math.pow(1 + r, n);
  const emi = (principal * r * factor) / (factor - 1);
  const totalPayment = emi * n;
  const totalInterest = totalPayment - principal;
  return { emi, totalInterest, totalPayment };
}

function sfmInitEmiCalculator(root) {
  const amountEl = root.querySelector("[data-emi-amount]");
  const rateEl = root.querySelector("[data-emi-rate]");
  const tenureEl = root.querySelector("[data-emi-tenure]");

  function render() {
    const amount = Number(amountEl.value);
    const rate = Number(rateEl.value);
    const tenure = Number(tenureEl.value);
    const { emi, totalInterest, totalPayment } = sfmComputeEMI(amount, rate, tenure);

    const amountOut = root.querySelector("[data-emi-amount-out]");
    const rateOut = root.querySelector("[data-emi-rate-out]");
    const tenureOut = root.querySelector("[data-emi-tenure-out]");
    if (amountOut) amountOut.textContent = sfmFormatINR(amount);
    if (rateOut) rateOut.textContent = rate.toFixed(2) + "% p.a.";
    if (tenureOut) tenureOut.textContent = tenure + (tenure === 1 ? " year" : " years");

    const emiOut = root.querySelector("[data-emi-emi]");
    const principalOut = root.querySelector("[data-emi-principal]");
    const interestOut = root.querySelector("[data-emi-interest]");
    const totalOut = root.querySelector("[data-emi-total]");
    if (emiOut) emiOut.textContent = sfmFormatINR(emi) + " / month";
    if (principalOut) principalOut.textContent = sfmFormatINR(amount);
    if (interestOut) interestOut.textContent = sfmFormatINR(totalInterest);
    if (totalOut) totalOut.textContent = sfmFormatINR(totalPayment);

    const barP = root.querySelector("[data-emi-bar-principal]");
    const barI = root.querySelector("[data-emi-bar-interest]");
    if (barP && barI) {
      const pPct = Math.max(4, (amount / totalPayment) * 100);
      barP.style.width = pPct + "%";
      barI.style.width = (100 - pPct) + "%";
    }
  }

  [amountEl, rateEl, tenureEl].forEach(el => el && el.addEventListener("input", render));
  render();

  const applyBtn = root.querySelector("[data-emi-apply]");
  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      const amount = amountEl.value;
      window.location.href = `application.html?amount=${encodeURIComponent(amount)}`;
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-emi-calc]").forEach(sfmInitEmiCalculator);
});
