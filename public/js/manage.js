// Client "manage my booking" page: view, add to calendar, reschedule, cancel.
(function () {
  const { h, api, money, SlotPicker } = window.UI;
  const box = document.getElementById("manage");
  const token = new URLSearchParams(location.search).get("t") || "";
  let cfg = null;
  let booking = null;

  function fillBusiness() {
    const { name, phone } = cfg.business;
    document.title = `Your booking | ${name}`;
    document.querySelectorAll("[data-biz-name]").forEach((el) => (el.textContent = name));
    document.querySelectorAll("[data-biz-phone]").forEach((el) => {
      el.hidden = !phone;
      el.textContent = phone;
      el.href = "tel:" + phone.replace(/[^\d+]/g, "");
    });
  }

  // "call (555) 123-4567" when there's a phone number, otherwise "contact us".
  const phoneLink = () => (cfg.business.phone
    ? h("span", {}, "call ", h("a", { href: "tel:" + cfg.business.phone.replace(/[^\d+]/g, "") }, cfg.business.phone))
    : h("span", {}, "contact us directly"));

  Promise.all([api("/api/config"), api(`/api/bookings/${encodeURIComponent(token)}`)])
    .then(([c, b]) => {
      cfg = c;
      booking = b;
      fillBusiness();
      render();
    })
    .catch(async () => {
      try { cfg = await api("/api/config"); fillBusiness(); } catch { /* ignore */ }
      box.replaceChildren(
        h("h1", { class: "manage-title" }, "We couldn't find that booking"),
        h("p", { class: "muted" }, "Make sure you used the full link from your confirmation. Still stuck? Give us a call and we'll sort it out."),
        h("a", { class: "btn btn-primary", href: "/#book" }, "Book a clean"));
    });

  function render(message = {}) {
    const b = booking;
    const first = b.name.split(" ")[0];
    const title = { confirmed: `See you soon, ${first}!`, cancelled: "This booking is cancelled", completed: `Thanks, ${first}!` }[b.status];
    const rows = [
      ["When", b.dateLabel, b.timeLabel],
      ["Service", b.serviceName, b.frequencyName !== cfg.frequencies[0].name ? b.frequencyName : null],
      ["Home", b.consultation ? null : `${b.bedrooms} bed, ${b.bathrooms} bath`],
      ["Add-ons", b.addonNames.join(", ")],
      ["Address", b.address],
      b.consultation ? ["Price", "Free consultation", "We'll send a custom quote afterwards."] : ["Estimated price", money(b.price)],
    ].filter((r) => r[1]);

    box.replaceChildren(...[
      h("span", { class: `status status-${b.status}` }, b.status),
      h("h1", { class: "manage-title" }, title),
      message.ok && h("p", { class: "form-ok", role: "status" }, message.ok),
      message.error && h("p", { class: "form-error", role: "alert" }, message.error),
      h("dl", { class: "detail-list" }, rows.map(([k, v, sub]) =>
        h("div", {}, h("dt", {}, k), h("dd", {}, v, sub ? h("span", {}, sub) : null)))),
      actions(),
    ].filter(Boolean));
  }

  function actions() {
    const b = booking;
    const bar = h("div", { class: "manage-actions" });
    if (b.status !== "confirmed") {
      bar.append(h("a", { class: "btn btn-primary", href: "/#book" }, b.status === "completed" ? "Book again" : "Book a new time"));
      return bar;
    }
    bar.append(h("a", { class: "btn btn-ghost", href: `/api/bookings/${token}/ics` }, "Add to calendar"));
    if (b.canChange) {
      bar.append(
        h("button", { type: "button", class: "btn btn-primary", onclick: showReschedule }, "Reschedule"),
        h("button", { type: "button", class: "btn btn-danger", onclick: () => confirmCancel(bar) }, "Cancel booking"));
    } else {
      bar.append(h("p", { class: "manage-note" },
        `Need to change something? Within ${b.cancelCutoffHours} hours of your appointment, please `, phoneLink(), "."));
    }
    return bar;
  }

  function confirmCancel(bar) {
    bar.replaceChildren(
      h("p", {}, "Are you sure you want to cancel this cleaning?"),
      h("button", { type: "button", class: "btn btn-danger", onclick: doCancel }, "Yes, cancel it"),
      h("button", { type: "button", class: "btn btn-ghost", onclick: () => render() }, "Keep my booking"));
  }

  async function doCancel(e) {
    e.currentTarget.disabled = true;
    try {
      booking = await api(`/api/bookings/${token}/cancel`, { method: "POST" });
      render({ ok: "Your booking has been cancelled." });
    } catch (err) {
      render({ error: err.message });
    }
  }

  function showReschedule() {
    let pick = { date: null, start: null };
    const schedule = h("div", { class: "bk-schedule" });
    const error = h("p", { class: "form-error", role: "alert", hidden: true });
    const confirm = h("button", { type: "button", class: "btn btn-primary", disabled: true, onclick: submit }, "Move my booking");

    box.replaceChildren(h("div", { class: "reschedule" },
      h("h2", { tabindex: "-1" }, "Pick a new time"),
      h("p", { class: "muted" }, `Currently: ${booking.dateLabel}, ${booking.timeLabel}`),
      error,
      schedule,
      h("div", { class: "bk-actions" },
        h("button", { type: "button", class: "btn btn-ghost", onclick: () => render() }, "Never mind"),
        confirm)));
    box.querySelector("h2").focus();

    const picker = SlotPicker(schedule, {
      minutes: booking.minutes,
      today: cfg.today,
      maxDaysAhead: cfg.maxDaysAhead,
      exclude: token,
      onSelect(date, start) {
        pick = { date, start };
        confirm.disabled = start == null;
      },
    });
    picker.open();

    async function submit() {
      confirm.disabled = true;
      confirm.textContent = "Moving...";
      try {
        booking = await api(`/api/bookings/${token}/reschedule`, { method: "POST", body: JSON.stringify(pick) });
        render({ ok: "Done! Your booking has been moved." });
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        confirm.textContent = "Move my booking";
        if (err.status === 409) picker.refresh();
      }
    }
  }
})();
