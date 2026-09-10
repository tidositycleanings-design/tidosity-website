// Homepage booking widget: 1) choose the clean  2) pick a date/time  3) enter details.
(function () {
  const root = document.getElementById("booker");
  if (!root) return;
  const { h, api, money, fmtTime, fmtDate, SlotPicker } = window.UI;
  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => Array.from(root.querySelectorAll(sel));

  const state = {
    cfg: null, quote: null, minutes: null, date: null, start: null, picker: null,
    sel: { service: null, bedrooms: 2, bathrooms: 1, frequency: "once", addons: [] },
  };
  const conflictMsg = h("p", { class: "form-error", role: "alert", hidden: true });

  api("/api/config").then(init).catch(() => {
    $("#bk-offline").hidden = false;
    $$(".bk-step").forEach((s) => (s.hidden = true));
    $(".booker-summary").hidden = true;
  });

  function chip(type, name, value, text, extra, checked) {
    return h("label", { class: "chip-opt" },
      h("input", { type, name, value, checked }),
      h("span", {}, text, extra ? h("em", {}, extra) : null));
  }

  function init(cfg) {
    const sel = state.sel;
    state.cfg = cfg;
    sel.service = cfg.services[0].id;
    const priceText = (s) => (s.consultation ? "Free consultation" : `Starting at ${money(s.base)}`);

    // Keep prices shown elsewhere on the page in sync with config.js.
    document.querySelectorAll("[data-cutoff]").forEach((el) => (el.textContent = cfg.cancelCutoffHours));
    document.querySelectorAll("[data-pricing-note]").forEach((el) => (el.textContent = cfg.pricingNote));
    document.querySelectorAll("[data-price-for]").forEach((el) => {
      const s = cfg.services.find((x) => x.id === el.dataset.priceFor);
      if (!s) return;
      el.replaceChildren(s.consultation ? "Free consultation" : "Starting at ", s.consultation ? "" : h("strong", {}, money(s.base)));
    });

    $("#bk-services").replaceChildren(...cfg.services.map((s) =>
      h("label", { class: "bk-service" },
        h("input", { type: "radio", name: "bk-service", value: s.id, checked: s.id === sel.service }),
        h("strong", {}, s.name),
        h("small", {}, priceText(s)))));

    const numbers = (max, word, selected) => Array.from({ length: max }, (_, i) =>
      h("option", { value: i + 1, selected: i + 1 === selected }, `${i + 1} ${word}${i ? "s" : ""}`));
    $("#bk-beds").replaceChildren(...numbers(cfg.maxBedrooms, "bedroom", sel.bedrooms));
    $("#bk-baths").replaceChildren(...numbers(cfg.maxBathrooms, "bathroom", sel.bathrooms));

    $("#bk-freq").replaceChildren(...cfg.frequencies.map((f) =>
      chip("radio", "bk-freq", f.id, f.name, f.discount ? `save ${Math.round(f.discount * 100)}%` : null, f.id === sel.frequency)));
    $("#bk-addons").replaceChildren(...cfg.addons.map((a) =>
      chip("checkbox", "bk-addon", a.id, a.name, `+${money(a.price)}`, false)));

    $("#bk-schedule").before(conflictMsg);
    state.picker = SlotPicker($("#bk-schedule"), {
      minutes: 60,
      today: cfg.today,
      maxDaysAhead: cfg.maxDaysAhead,
      onSelect(date, start) {
        state.date = date;
        state.start = start;
        if (start != null) conflictMsg.hidden = true;
        $("#bk-to-details").disabled = start == null;
        renderSummary();
      },
    });

    $("[data-step='1']").addEventListener("change", update);
    update();
  }

  function update() {
    const { cfg, sel } = state;
    sel.service = $("input[name='bk-service']:checked").value;
    sel.bedrooms = Number($("#bk-beds").value);
    sel.bathrooms = Number($("#bk-baths").value);
    sel.frequency = ($("input[name='bk-freq']:checked") || {}).value || "once";
    sel.addons = $$("input[name='bk-addon']:checked").map((i) => i.value);
    const service = cfg.services.find((s) => s.id === sel.service);
    $("#bk-size").hidden = Boolean(service.consultation);
    $("#bk-freq-wrap").hidden = !service.recurring || Boolean(service.consultation);
    $("#bk-addons-wrap").hidden = Boolean(service.consultation) || !cfg.addons.length;
    $("#bk-consult-note").hidden = !service.consultation;

    state.quote = Pricing.quote(cfg, sel);
    // A longer or shorter clean changes which times fit, so forget any picked time.
    if (state.quote.minutes !== state.minutes) {
      state.minutes = state.quote.minutes;
      state.picker.setMinutes(state.minutes);
      state.date = null;
      state.start = null;
      $("#bk-to-details").disabled = true;
    }
    renderSummary();
  }

  function renderSummary() {
    const q = state.quote;
    const rows = [["Service", q.serviceName]];
    if (!q.consultation) rows.push(["Home", `${q.bedrooms} bed, ${q.bathrooms} bath`]);
    if (q.frequency !== state.cfg.frequencies[0].id) rows.push(["How often", q.frequencyName]);
    if (q.addonNames.length) rows.push(["Add-ons", q.addonNames.join(", ")]);
    if (q.discount) rows.push(["Recurring discount", "−" + money(q.discount)]);
    if (state.start != null) {
      rows.push(["When", `${fmtDate(state.date, { weekday: "short", month: "short", day: "numeric" })}, ${fmtTime(state.start)}`]);
    }
    $("#bk-summary").replaceChildren(...rows.map(([k, v]) => h("div", {}, h("dt", {}, k), h("dd", {}, v))));
    if (q.consultation) {
      $("#bk-price-label").textContent = "Consultation";
      $("#bk-price").textContent = "Free";
      $("#bk-duration").textContent = `About ${Pricing.formatDuration(q.minutes)}`;
      $("#bk-note").textContent = "We'll send a custom plan and quote afterwards.";
    } else {
      $("#bk-price-label").textContent = "Estimated total";
      $("#bk-price").textContent = money(q.price);
      $("#bk-duration").textContent = `About ${Pricing.formatDuration(q.minutes)} of cleaning`;
      $("#bk-note").textContent = state.cfg.pricingNote || "";
    }
  }

  // "Book this clean" links elsewhere on the page preselect that service.
  document.addEventListener("click", (e) => {
    const link = e.target.closest("[data-book-service]");
    if (!link || !state.cfg) return;
    const radio = $(`input[name='bk-service'][value='${link.dataset.bookService}']`);
    if (!radio) return;
    radio.checked = true;
    update();
    go(1);
  });

  function go(step) {
    if (step === 3 && state.start == null) return;
    $$(".bk-step").forEach((s) => (s.hidden = s.dataset.step !== String(step)));
    $$("[data-progress]").forEach((li) => {
      const n = Number(li.dataset.progress);
      li.classList.toggle("is-active", n === step);
      li.classList.toggle("is-done", step === "done" || n < step);
      if (n === step) li.setAttribute("aria-current", "step");
      else li.removeAttribute("aria-current");
    });
    if (step === 2) state.picker.open();

    if (root.getBoundingClientRect().top < 0) root.scrollIntoView({ behavior: "smooth", block: "start" });
    const heading = $(`[data-step="${step}"] h3`);
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
  }

  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-go]");
    if (btn && !btn.disabled) go(Number(btn.dataset.go));
  });

  $("#bk-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const error = $("#bk-error");
    const btn = $("#bk-submit");
    error.hidden = true;
    if (!form.checkValidity()) return form.reportValidity();

    btn.disabled = true;
    btn.textContent = "Booking...";
    try {
      const booking = await api("/api/bookings", {
        method: "POST",
        body: JSON.stringify({ ...state.sel, date: state.date, start: state.start, ...Object.fromEntries(new FormData(form)) }),
      });
      form.reset();
      showDone(booking);
    } catch (err) {
      if (err.status === 409) {
        // Someone grabbed that time first: send them back to pick another.
        conflictMsg.textContent = err.message;
        conflictMsg.hidden = false;
        state.start = null;
        $("#bk-to-details").disabled = true;
        renderSummary();
        go(2);
        state.picker.refresh();
      } else {
        error.textContent = err.message;
        error.hidden = false;
      }
    } finally {
      btn.disabled = false;
      btn.textContent = "Confirm booking";
    }
  });

  function showDone(b) {
    const email = state.cfg.emailEnabled
      ? "A confirmation email is on its way."
      : "Save the link below. You can use it to view, reschedule, or cancel.";
    $("#bk-done-text").textContent = `${b.serviceName} on ${b.dateLabel}, ${b.timeLabel}. ${email}`;
    $("#bk-ics").href = `/api/bookings/${b.token}/ics`;
    $("#bk-manage").href = `/manage?t=${b.token}`;
    go("done");
  }
})();
