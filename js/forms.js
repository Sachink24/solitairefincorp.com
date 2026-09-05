/* Generic handler for any <form data-enquiry-type="..."> on the site.
   Maps form fields to the public.website_enquiries columns and inserts a row. */
function sfmAttachEnquiryForm(form) {
  const msgEl = form.querySelector(".form-msg");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalLabel = submitBtn.textContent;
    submitBtn.disabled = true; submitBtn.textContent = "Submitting…";
    msgEl.className = "form-msg"; msgEl.textContent = "";

    const fd = new FormData(form);
    const get = (name) => (fd.get(name) || "").toString().trim() || null;
    const num = (name) => { const v = get(name); return v ? Number(v.replace(/[^\d.]/g, "")) : null; };

    const payload = {
      enquiry_type: form.dataset.enquiryType || "general",
      full_name: get("full_name"),
      mobile: get("mobile"),
      email: get("email"),
      city: get("city"),
      company_name: get("company_name"),
      product_interest: get("product_interest"),
      funding_requirement: num("funding_requirement"),
      message: get("message"),
    };

    try {
      if (!payload.full_name || !payload.mobile) {
        throw new Error("validation");
      }
      await sfmSaveEnquiry(payload);
      msgEl.textContent = `Thank you, ${payload.full_name.split(" ")[0]}. Your enquiry has been received — our team at SOLITAIRE FINZ MART will call you on ${payload.mobile} shortly. You can also reach us anytime at ${SFM.business.phone}.`;
      msgEl.classList.add("show", "ok");
      form.reset();
    } catch (err) {
      if (err && err.message === "validation") {
        msgEl.textContent = "Please enter your name and mobile number so our team can reach you.";
      } else {
        msgEl.textContent = `We couldn't submit this right now. Please call us at ${SFM.business.phone} or email ${SFM.business.email} and we'll assist you directly.`;
      }
      msgEl.classList.add("show", "err");
    } finally {
      submitBtn.disabled = false; submitBtn.textContent = originalLabel;
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("form[data-enquiry-type]").forEach(sfmAttachEnquiryForm);
});
