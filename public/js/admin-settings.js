// Dashboard settings tabs: Services & prices, Business info (+ reviews), Email alerts, Password.
(function () {
  const { h } = window.UI;
  const Admin = window.Admin;
  const $ = (id) => document.getElementById(id);

  // Number input that writes into an object as the owner types.
  function numberInput(obj, key, { step = 1, min = 0, max, toStore = Number, toShow = (v) => v } = {}) {
    const input = h("input", { type: "number", step, min, max, value: toShow(obj[key] ?? 0), inputmode: "decimal" });
    input.addEventListener("input", () => { obj[key] = toStore(input.value === "" ? 0 : Number(input.value)); });
    return input;
  }
  function textInput(obj, key, attrs = {}) {
    const tag = attrs.rows ? "textarea" : "input";
    const input = h(tag, { ...attrs, ...(tag === "input" ? { value: obj[key] || "" } : {}) });
    if (tag === "textarea") input.value = obj[key] || "";
    input.addEventListener("input", () => { obj[key] = input.value; });
    return input;
  }
  function checkbox(obj, key, label, onChange) {
    const input = h("input", { type: "checkbox", checked: Boolean(obj[key]) });
    input.addEventListener("change", () => { obj[key] = input.checked; if (onChange) onChange(input.checked); });
    return h("label", { class: "check" }, input, label);
  }
  const field = (label, input, cls = "field") => h("label", { class: cls }, h("span", {}, label), input);
  const hours = { step: 0.25, toShow: (m) => Math.round((m / 60) * 100) / 100, toStore: (v) => Math.round(v * 60) };

  // Shrinks a photo in the browser before uploading, so big phone photos upload quickly.
  async function resizePhoto(file) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1400 / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  }

  async function uploadPhoto(file) {
    let dataUrl;
    try { dataUrl = await resizePhoto(file); } catch {
      throw new Error("That photo type isn't supported. Please choose a JPG or PNG photo.");
    }
    const { url } = await Admin.api("/api/admin/upload", { method: "POST", body: JSON.stringify({ dataUrl }) });
    return url;
  }

  // ------------------------------------------------------------ services & prices
  const servicesForm = $("services-form");
  Admin.track(servicesForm, "services");
  let catalog = null;

  async function loadServices() {
    catalog = await Admin.api("/api/admin/catalog");
    renderServices();
    renderAddons();
    servicesForm.elements.pricingNote.value = catalog.pricingNote || "";
    servicesForm.elements.maxBedrooms.value = catalog.maxBedrooms;
    servicesForm.elements.maxBathrooms.value = catalog.maxBathrooms;
    $("discounts").replaceChildren(...catalog.frequencies.filter((f) => f.id !== "once").map((f) =>
      field(h("span", {}, `${f.name} discount `, h("small", {}, "(% off)")),
        numberInput(f, "discount", { max: 90, toShow: (d) => Math.round(d * 100), toStore: (v) => v / 100 }))));
    Admin.saved("services");
  }
  Admin.panels.services = { load: loadServices };

  const changed = () => Admin.dirty.add("services");

  function renderServices() {
    $("service-list").replaceChildren(...catalog.services.map(serviceCard));
  }

  function serviceCard(s, index) {
    const list = catalog.services;
    const card = h("article", { class: "svc-card" + (s.consultation ? " is-consultation" : "") + (s.visible === false ? " is-hidden" : "") });

    // Photo
    const thumb = s.photo ? h("img", { class: "svc-thumb", src: s.photo, alt: "" }) : h("div", { class: "svc-thumb svc-thumb-empty" }, "No photo");
    const file = h("input", { type: "file", accept: "image/*", hidden: true });
    const photoBtn = h("button", { type: "button", class: "btn btn-ghost btn-sm" }, s.photo ? "Change photo" : "Add photo");
    photoBtn.addEventListener("click", () => file.click());
    file.addEventListener("change", async () => {
      if (!file.files[0]) return;
      photoBtn.disabled = true;
      photoBtn.textContent = "Uploading...";
      try {
        s.photo = await uploadPhoto(file.files[0]);
        changed();
        renderServices();
        Admin.toast("Photo added. Click Save to put it on your website.");
      } catch (err) {
        if (err.status !== 401) Admin.toast(err.message, true);
        photoBtn.disabled = false;
        photoBtn.textContent = s.photo ? "Change photo" : "Add photo";
      }
    });
    const removePhoto = s.photo
      ? h("button", { type: "button", class: "link-btn", onclick: () => { s.photo = ""; changed(); renderServices(); } }, "Remove photo")
      : null;

    // Buttons
    const move = (dir) => () => {
      const j = index + dir;
      [list[index], list[j]] = [list[j], list[index]];
      changed();
      renderServices();
    };
    const remove = () => {
      if (list.length === 1) return Admin.toast("You need at least one service.", true);
      if (catalog.bookingCounts[s.id] > 0) {
        return Admin.toast(`"${s.name}" has bookings, so it can't be deleted. Untick "Show on website" to hide it instead.`, true);
      }
      if (!confirm(`Delete "${s.name || "this service"}"?`)) return;
      list.splice(index, 1);
      changed();
      renderServices();
    };

    card.append(
      h("div", { class: "svc-photo" }, thumb, photoBtn, removePhoto, file),
      h("div", { class: "svc-fields" },
        field("Service name", textInput(s, "name", { maxlength: 80, required: true })),
        field("Description (shown on your website)", textInput(s, "description", { rows: 2, maxlength: 400 })),
        h("div", { class: "svc-toggles" },
          checkbox(s, "visible", "Show on website", (on) => card.classList.toggle("is-hidden", !on)),
          checkbox(s, "consultation", "Free consultation instead of a price", (on) => card.classList.toggle("is-consultation", on)),
          h("span", { class: "only-priced" }, checkbox(s, "recurring", "Clients can pick weekly / every 2 weeks / monthly"))),
        h("div", { class: "svc-grid only-priced" },
          field("Starting price ($)", numberInput(s, "base", { max: 100000 })),
          field("Each extra bedroom (+$)", numberInput(s, "perBed", { max: 10000 })),
          field("Each extra bathroom (+$)", numberInput(s, "perBath", { max: 10000 }))),
        h("div", { class: "svc-grid" },
          field(h("span", {}, h("span", { class: "only-priced" }, "Hours for a 1 bed / 1 bath home"), h("span", { class: "only-consult" }, "Consultation length (hours)")),
            numberInput(s, "baseMinutes", { ...hours, min: 0.25, max: 24 })),
          h("span", { class: "only-priced" }, field("Extra hours per bedroom", numberInput(s, "perBedMinutes", { ...hours, max: 10 }))),
          h("span", { class: "only-priced" }, field("Extra hours per bathroom", numberInput(s, "perBathMinutes", { ...hours, max: 10 }))))),
      h("div", { class: "svc-actions" },
        h("button", { type: "button", class: "btn btn-ghost btn-sm", disabled: index === 0, onclick: move(-1), "aria-label": "Move up" }, "↑ Up"),
        h("button", { type: "button", class: "btn btn-ghost btn-sm", disabled: index === list.length - 1, onclick: move(1), "aria-label": "Move down" }, "↓ Down"),
        h("button", { type: "button", class: "btn btn-danger btn-sm", onclick: remove }, "Delete")));
    return card;
  }

  $("add-service").addEventListener("click", () => {
    catalog.services.push({
      id: "", name: "New service", visible: true, recurring: false, consultation: false, description: "", photo: "",
      base: 100, perBed: 20, perBath: 20, baseMinutes: 120, perBedMinutes: 30, perBathMinutes: 30,
    });
    changed();
    renderServices();
    const last = $("service-list").lastElementChild;
    last.scrollIntoView({ behavior: "smooth", block: "center" });
    last.querySelector("input").select();
  });

  function renderAddons() {
    if (!catalog.addons.length) {
      return $("addon-list").replaceChildren(h("p", { class: "muted" }, "No add-ons yet."));
    }
    $("addon-list").replaceChildren(...catalog.addons.map((a, i) =>
      h("div", { class: "row-item addon-row" },
        field("Add-on name", textInput(a, "name", { maxlength: 60, placeholder: "e.g. Inside the oven" })),
        field("Price (+$)", numberInput(a, "price", { max: 10000 })),
        field("Extra time (minutes)", numberInput(a, "minutes", { step: 5, max: 600 })),
        h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => { catalog.addons.splice(i, 1); changed(); renderAddons(); } }, "Remove"))));
  }

  $("add-addon").addEventListener("click", () => {
    catalog.addons.push({ id: "", name: "", price: 25, minutes: 30 });
    changed();
    renderAddons();
    $("addon-list").lastElementChild.querySelector("input").focus();
  });

  servicesForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = servicesForm.querySelector("button[type=submit]");
    $("services-error").hidden = true;
    btn.disabled = true;
    try {
      const saved = await Admin.api("/api/admin/catalog", {
        method: "PUT",
        body: JSON.stringify({
          services: catalog.services, addons: catalog.addons, frequencies: catalog.frequencies,
          pricingNote: servicesForm.elements.pricingNote.value,
          maxBedrooms: Number(servicesForm.elements.maxBedrooms.value),
          maxBathrooms: Number(servicesForm.elements.maxBathrooms.value),
        }),
      });
      catalog = { ...saved, bookingCounts: catalog.bookingCounts };
      renderServices();
      renderAddons();
      Admin.saved("services");
      Admin.toast("Saved. Your website and booking form are updated.");
      Admin.refreshChecklist();
    } catch (err) {
      Admin.showError($("services-error"), err);
    } finally {
      btn.disabled = false;
    }
  });

  // ------------------------------------------------------------ business info
  const businessForm = $("business-form");
  const reviewsForm = $("reviews-form");
  Admin.track(businessForm, "business");
  Admin.track(reviewsForm, "business:reviews");
  const faqForm = $("faq-form");
  Admin.track(faqForm, "business:faq");
  let reviews = [];
  let faq = [];

  async function loadBusiness() {
    const [biz, content] = await Promise.all([Admin.api("/api/admin/business"), Admin.api("/api/admin/content")]);
    const f = businessForm.elements;
    for (const key of ["name", "phone", "email", "notifyEmail", "siteUrl"]) f[key].value = biz[key] || "";
    f.area.value = (biz.area || []).join(", ");
    Admin.fillTimezones(f.timezone, biz.timezone);
    reviews = content.reviews || [];
    faq = content.faq || [];
    renderReviews();
    renderFaq();
    Admin.saved("business");
    Admin.saved("business:reviews");
    Admin.saved("business:faq");
  }
  Admin.panels.business = { load: loadBusiness };

  businessForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = businessForm.querySelector("button[type=submit]");
    $("business-error").hidden = true;
    btn.disabled = true;
    try {
      await Admin.api("/api/admin/business", { method: "PUT", body: JSON.stringify(Object.fromEntries(new FormData(businessForm))) });
      Admin.saved("business");
      Admin.toast("Saved. Your website is updated.");
      Admin.refreshChecklist();
    } catch (err) {
      Admin.showError($("business-error"), err);
    } finally {
      btn.disabled = false;
    }
  });

  function renderReviews() {
    if (!reviews.length) return $("review-list").replaceChildren(h("p", { class: "muted" }, "No reviews yet. The reviews section is hidden on your website until you add one."));
    $("review-list").replaceChildren(...reviews.map((r, i) =>
      h("div", { class: "row-item review-row" },
        field("What they said", textInput(r, "text", { rows: 3, maxlength: 1000 }), "field review-text"),
        field("Their name", textInput(r, "name", { maxlength: 80, placeholder: "e.g. Maria G." })),
        field("Label (optional)", textInput(r, "label", { maxlength: 80, placeholder: "e.g. Airbnb host" })),
        h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => {
          if (!confirm("Remove this review?")) return;
          reviews.splice(i, 1);
          Admin.dirty.add("business:reviews");
          renderReviews();
        } }, "Remove"))));
  }

  $("add-review").addEventListener("click", () => {
    reviews.push({ name: "", label: "", text: "" });
    Admin.dirty.add("business:reviews");
    renderReviews();
    $("review-list").lastElementChild.querySelector("textarea").focus();
  });

  reviewsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = reviewsForm.querySelector("button[type=submit]");
    $("reviews-error").hidden = true;
    btn.disabled = true;
    try {
      const saved = await Admin.api("/api/admin/content", { method: "PUT", body: JSON.stringify({ reviews }) });
      reviews = saved.reviews;
      renderReviews();
      Admin.saved("business:reviews");
      Admin.toast("Reviews saved. Your website is updated.");
    } catch (err) {
      Admin.showError($("reviews-error"), err);
    } finally {
      btn.disabled = false;
    }
  });

  // ------------------------------------------------------------ FAQ
  function renderFaq() {
    if (!faq.length) return $("faq-list").replaceChildren(h("p", { class: "muted" }, "No questions yet. The FAQ section is hidden on your website until you add one."));
    $("faq-list").replaceChildren(...faq.map((item, i) =>
      h("div", { class: "row-item faq-row" },
        field("Question", textInput(item, "q", { maxlength: 200, placeholder: "e.g. Do you bring your own supplies?" })),
        field("Answer", textInput(item, "a", { rows: 3, maxlength: 1500 })),
        h("div", { class: "faq-row-actions" },
          h("button", { type: "button", class: "btn btn-ghost btn-sm", disabled: i === 0, "aria-label": "Move up", onclick: () => {
            [faq[i - 1], faq[i]] = [faq[i], faq[i - 1]];
            Admin.dirty.add("business:faq");
            renderFaq();
          } }, "↑ Up"),
          h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => {
            if (!confirm("Remove this question?")) return;
            faq.splice(i, 1);
            Admin.dirty.add("business:faq");
            renderFaq();
          } }, "Remove")))));
  }

  $("add-faq").addEventListener("click", () => {
    faq.push({ q: "", a: "" });
    Admin.dirty.add("business:faq");
    renderFaq();
    $("faq-list").lastElementChild.querySelector("input").focus();
  });

  faqForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = faqForm.querySelector("button[type=submit]");
    $("faq-error").hidden = true;
    btn.disabled = true;
    try {
      const saved = await Admin.api("/api/admin/content", { method: "PUT", body: JSON.stringify({ faq }) });
      faq = saved.faq;
      renderFaq();
      Admin.saved("business:faq");
      Admin.toast("Questions saved. Your website is updated.");
    } catch (err) {
      Admin.showError($("faq-error"), err);
    } finally {
      btn.disabled = false;
    }
  });

  // ------------------------------------------------------------ email alerts
  const emailForm = $("email-form");
  Admin.track(emailForm, "email");

  const HELP = {
    gmail: {
      link: "https://myaccount.google.com/apppasswords",
      steps: ["Make sure 2-Step Verification is turned on for your Google account.",
        "Open Google App Passwords (link below) and sign in.",
        "Type a name like \"Booking website\" and click Create.",
        "Copy the 16-letter password Google shows you and paste it above."],
    },
    yahoo: {
      link: "https://login.yahoo.com/account/security",
      steps: ["Open Yahoo Account Security (link below) and sign in.",
        "Click \"Generate app password\" (or \"Manage app passwords\").",
        "Name it \"Booking website\" and click Generate.",
        "Copy the password and paste it above."],
    },
    icloud: {
      link: "https://account.apple.com",
      steps: ["Open your Apple Account (link below) and sign in.",
        "Go to Sign-In and Security, then App-Specific Passwords.",
        "Create one named \"Booking website\".",
        "Copy the password and paste it above. Use your @icloud.com address as the email."],
    },
    other: {
      link: "",
      steps: ["Ask your email provider (or your web host) for their SMTP server name and port.",
        "Use your full email address, and the password or app password they give you."],
    },
  };

  function renderEmailHelp() {
    const provider = emailForm.elements.provider.value;
    const help = HELP[provider] || HELP.other;
    emailForm.querySelectorAll("[data-other]").forEach((el) => (el.hidden = provider !== "other"));
    $("email-help").replaceChildren(
      h("strong", {}, "How to get an app password"),
      h("ol", {}, help.steps.map((s) => h("li", {}, s))),
      help.link ? h("a", { href: help.link, target: "_blank", rel: "noopener noreferrer" }, "Open the app password page ↗") : null,
      h("p", { class: "muted small" }, "An app password is a special password just for this website. Your normal email password stays private."));
  }
  emailForm.elements.provider.addEventListener("change", renderEmailHelp);

  function showEmailStatus(view) {
    const status = $("email-status");
    if (view.enabled && view.tested) {
      status.className = "status-line is-on";
      status.textContent = `✓ Email is on. New-booking alerts go to ${view.alertsGoTo}.`;
    } else {
      status.className = "status-line";
      status.textContent = "Email is off. Fill in the form below to turn it on.";
    }
    $("email-off").hidden = !view.enabled;
  }

  async function loadEmail() {
    const view = await Admin.api("/api/admin/email");
    const f = emailForm.elements;
    f.provider.replaceChildren(...Object.entries(view.providers).map(([id, label]) => h("option", { value: id }, label)));
    f.provider.value = view.provider || "gmail";
    f.user.value = view.user || "";
    f.pass.value = "";
    f.pass.placeholder = view.hasPassword ? "Saved (leave empty to keep it)" : "Paste your app password here";
    f.host.value = view.host || "";
    f.port.value = view.port || 587;
    renderEmailHelp();
    showEmailStatus(view);
    Admin.saved("email");
  }
  Admin.panels.email = { load: loadEmail };

  emailForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = emailForm.querySelector("button[type=submit]");
    $("email-error").hidden = true;
    btn.disabled = true;
    btn.textContent = "Sending a test email...";
    try {
      const view = await Admin.api("/api/admin/email/test", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(emailForm))) });
      emailForm.elements.pass.value = "";
      emailForm.elements.pass.placeholder = "Saved (leave empty to keep it)";
      showEmailStatus(view);
      Admin.saved("email");
      Admin.toast(`It works! A test email was sent to ${view.sentTo}.`);
      Admin.refreshChecklist();
    } catch (err) {
      Admin.showError($("email-error"), err);
    } finally {
      btn.disabled = false;
      btn.textContent = "Save & send a test email";
    }
  });

  $("email-off").addEventListener("click", async () => {
    if (!confirm("Turn off email? Clients won't get confirmation emails and you won't get booking alerts.")) return;
    try {
      showEmailStatus(await Admin.api("/api/admin/email/disable", { method: "POST" }));
      Admin.toast("Email is turned off.");
      Admin.refreshChecklist();
    } catch (err) {
      if (err.status !== 401) Admin.toast(err.message, true);
    }
  });

  // ------------------------------------------------------------ password
  const passwordForm = $("password-form");
  Admin.panels.password = { load: async () => passwordForm.reset() };

  passwordForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(passwordForm));
    const error = $("password-error");
    error.hidden = true;
    if (data.next.length < 8) return Admin.showError(error, { message: "Please choose a password with at least 8 characters." });
    if (data.next !== data.confirm) return Admin.showError(error, { message: "The two new passwords don't match." });
    try {
      await Admin.api("/api/admin/password", { method: "PUT", body: JSON.stringify(data) });
      passwordForm.reset();
      Admin.toast("Password changed.");
    } catch (err) {
      Admin.showError(error, err);
    }
  });
})();
