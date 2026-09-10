// Owner dashboard: first-run setup, sign in, tabs, setup checklist, and the Bookings tab.
// The Schedule tab is in admin-schedule.js; the settings tabs are in admin-settings.js.
(function () {
  const { h, api, money, fmtTime, fmtDate, addDays } = window.UI;
  const $ = (id) => document.getElementById(id);
  const Admin = (window.Admin = { panels: {}, dirty: new Set() });

  // ------------------------------------------------------------ helpers shared by all tabs
  const toastEl = h("div", { class: "toast", role: "status", hidden: true });
  document.body.append(toastEl);
  let toastTimer;
  Admin.toast = function (message, isError) {
    toastEl.textContent = message;
    toastEl.className = "toast" + (isError ? " is-error" : "");
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), 4000);
  };

  // Any 401 (e.g. signed out on another device) goes back to the sign-in screen.
  Admin.api = async function (path, options) {
    try {
      return await api(path, options);
    } catch (err) {
      if (err.status === 401) showLogin("Please sign in again.");
      throw err;
    }
  };

  Admin.showError = function (el, err) {
    if (err.status === 401) return;
    el.textContent = err.message;
    el.hidden = false;
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  // Unsaved-changes tracking, keyed by tab name.
  Admin.track = (form, tab) => {
    const mark = () => Admin.dirty.add(tab);
    form.addEventListener("input", mark);
    form.addEventListener("change", mark);
  };
  Admin.saved = (tab) => Admin.dirty.delete(tab);
  window.addEventListener("beforeunload", (e) => {
    if (Admin.dirty.size) { e.preventDefault(); e.returnValue = ""; }
  });

  const US_ZONES = [
    ["America/New_York", "Eastern time"], ["America/Chicago", "Central time"], ["America/Denver", "Mountain time"],
    ["America/Phoenix", "Arizona time"], ["America/Los_Angeles", "Pacific time"], ["America/Anchorage", "Alaska time"],
    ["Pacific/Honolulu", "Hawaii time"],
  ];
  Admin.fillTimezones = function (select, current) {
    const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    select.replaceChildren(
      h("optgroup", { label: "United States" }, US_ZONES.map(([id, label]) => h("option", { value: id }, label))),
      h("optgroup", { label: "Other places" },
        all.filter((z) => !US_ZONES.some(([id]) => id === z)).map((z) => h("option", { value: z }, z.replace(/_/g, " ")))));
    select.value = current;
    if (current && select.value !== current) {
      select.prepend(h("option", { value: current }, current.replace(/_/g, " ")));
      select.value = current;
    }
  };

  // ------------------------------------------------------------ setup / sign in
  function showOnly(id) {
    ["setup", "login", "dash"].forEach((x) => ($(x).hidden = x !== id));
    $("admin-actions").hidden = id !== "dash";
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const me = await api("/api/admin/me").catch(() => ({}));
    document.title = `Dashboard | ${me.business || "Bookings"}`;
    if (me.needsSetup) showSetup(me);
    else if (me.authed) showDashboard();
    else showLogin();
  });

  function showSetup(me) {
    showOnly("setup");
    const f = $("setup");
    f.elements.name.value = me.business || "";
    let guess = me.timezone;
    try { guess = Intl.DateTimeFormat().resolvedOptions().timeZone || guess; } catch { /* keep default */ }
    Admin.fillTimezones(f.elements.timezone, guess);
    f.elements.password.focus();
  }

  $("setup").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const error = $("setup-error");
    const btn = form.querySelector("button[type=submit]");
    const data = Object.fromEntries(new FormData(form));
    error.hidden = true;
    if (data.password.length < 8) return Admin.showError(error, { message: "Please choose a password with at least 8 characters." });
    if (data.password !== data.confirm) return Admin.showError(error, { message: "The two passwords don't match." });
    if (!data.name.trim()) return Admin.showError(error, { message: "Please enter your business name." });
    btn.disabled = true;
    try {
      await api("/api/admin/setup", { method: "POST", body: JSON.stringify(data) });
      form.reset();
      showDashboard(true);
    } catch (err) {
      Admin.showError(error, err);
    } finally {
      btn.disabled = false;
    }
  });

  function showLogin(message) {
    showOnly("login");
    $("login-error").hidden = !message;
    if (message) $("login-error").textContent = message;
    $("login").elements.password.focus();
  }

  $("login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const btn = form.querySelector("button[type=submit]");
    $("login-error").hidden = true;
    btn.disabled = true;
    try {
      await api("/api/admin/login", { method: "POST", body: JSON.stringify({ password: form.elements.password.value }) });
      form.reset();
      showDashboard();
    } catch (err) {
      Admin.showError($("login-error"), err);
    } finally {
      btn.disabled = false;
    }
  });

  $("logout").addEventListener("click", async () => {
    if (Admin.dirty.size && !confirm("You have changes that aren't saved yet. Sign out anyway?")) return;
    Admin.dirty.clear();
    await api("/api/admin/logout", { method: "POST" }).catch(() => {});
    showLogin();
  });

  function showDashboard(welcome) {
    showOnly("dash");
    Admin.refreshChecklist();
    selectTab(location.hash.slice(1), true);
    if (welcome) Admin.toast("You're set up! Follow the checklist to finish.");
  }

  // ------------------------------------------------------------ setup checklist
  Admin.refreshChecklist = async function () {
    try {
      const { siteUrl, checklist } = await Admin.api("/api/admin/overview");
      $("site-link").textContent = siteUrl.replace(/^https?:\/\//, "");
      $("site-link").href = siteUrl;
      const complete = checklist.every((c) => c.done);
      $("checklist").hidden = false;
      $("checklist").classList.toggle("is-complete", complete);
      $("checklist").querySelector("h2").textContent = complete ? "Your booking website is ready" : "Finish setting up";
      $("checklist").querySelector(".muted").textContent = complete
        ? "Share your link so clients can book you online."
        : "A few quick steps and you're ready for bookings.";
      $("checklist-items").replaceChildren(...checklist.map((c) =>
        h("li", { class: c.done ? "is-done" : "" },
          h("span", { class: "check-dot", "aria-hidden": "true" }),
          h("span", { class: "check-label" }, c.label),
          c.done
            ? h("span", { class: "check-done" }, "Done")
            : h("button", { type: "button", class: "btn btn-sm btn-primary", onclick: () => selectTab(c.tab) }, "Do this"))));
    } catch { /* not signed in */ }
  };

  $("copy-link").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("site-link").href);
      Admin.toast("Link copied. Paste it anywhere to share.");
    } catch {
      Admin.toast("Couldn't copy automatically. Select the link and copy it.", true);
    }
  });

  // ------------------------------------------------------------ tabs
  // A tab counts as unsaved if any of its forms are ("business" and "business:reviews", etc).
  const tabDirty = (tab) => [...Admin.dirty].some((k) => k === tab || k.startsWith(tab + ":"));

  function selectTab(name, initial) {
    if (!Admin.panels[name]) name = "bookings";
    const current = document.querySelector("[data-tab][aria-selected='true']").dataset.tab;
    if (current === name && tabDirty(name) && !initial) return;
    if (current !== name && tabDirty(current) &&
        !confirm("You have changes that aren't saved yet. Leave this tab without saving?")) return;
    [...Admin.dirty].filter((k) => k === current || k.startsWith(current + ":")).forEach((k) => Admin.dirty.delete(k));
    document.querySelectorAll("[data-tab]").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
    document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== name));
    history.replaceState(null, "", "#" + name);
    Admin.panels[name].load().catch(() => {});
    if (!initial) document.querySelector(".tabs").scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  Admin.selectTab = selectTab;

  document.querySelector(".tabs").addEventListener("click", (e) => {
    const tab = e.target.closest("[data-tab]");
    if (tab) selectTab(tab.dataset.tab);
  });

  // ------------------------------------------------------------ bookings
  const state = { range: "upcoming", showCancelled: false, today: null, bookings: [] };

  $("range").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-range]");
    if (!btn) return;
    state.range = btn.dataset.range;
    $("range").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
    loadBookings().catch(() => {});
  });
  $("show-cancelled").addEventListener("change", (e) => {
    state.showCancelled = e.target.checked;
    renderBookings();
  });

  async function loadBookings() {
    const cfg = await api("/api/config");
    state.today = cfg.today;
    const range = state.range === "upcoming"
      ? { from: cfg.today, to: addDays(cfg.today, 366) }
      : { from: addDays(cfg.today, -30), to: addDays(cfg.today, -1) };
    const data = await Admin.api("/api/admin/bookings?" + new URLSearchParams(range));
    state.bookings = data.bookings;
    renderStats();
    renderBookings();
  }
  Admin.panels.bookings = { load: loadBookings };

  function renderStats() {
    const active = state.bookings.filter((b) => b.status !== "cancelled");
    const sum = (list) => money(list.reduce((total, b) => total + b.price, 0));
    const stats = state.range === "upcoming"
      ? (() => {
        const week = active.filter((b) => b.date < addDays(state.today, 7));
        return [["Jobs today", active.filter((b) => b.date === state.today).length], ["Next 7 days", week.length],
          ["Next 7 days (estimated)", sum(week)], ["All upcoming", active.length]];
      })()
      : [["Jobs (last 30 days)", active.length], ["Marked done", active.filter((b) => b.status === "completed").length],
        ["Earned (estimated)", sum(active)], ["Cancelled", state.bookings.length - active.length]];
    $("stats").replaceChildren(...stats.map(([label, value]) => h("div", { class: "stat" }, h("span", {}, label), h("strong", {}, String(value)))));
  }

  function dayTitle(date) {
    const prefix = date === state.today ? "Today, " : date === addDays(state.today, 1) ? "Tomorrow, " : "";
    return prefix + fmtDate(date, { weekday: "long", month: "long", day: "numeric" });
  }

  function renderBookings() {
    let items = state.bookings.filter((b) => state.showCancelled || b.status !== "cancelled");
    if (state.range === "past") items = items.slice().reverse();
    if (!items.length) {
      const msg = state.range === "upcoming"
        ? "No upcoming bookings yet. Share your website link so clients can book."
        : "No bookings in the last 30 days.";
      return $("booking-list").replaceChildren(h("div", { class: "card empty" }, msg));
    }
    const groups = new Map();
    for (const b of items) {
      if (!groups.has(b.date)) groups.set(b.date, []);
      groups.get(b.date).push(b);
    }
    $("booking-list").replaceChildren(...[...groups].map(([date, list]) =>
      h("section", { class: "day-group" },
        h("h3", { class: "day-title" }, dayTitle(date), h("span", {}, `${list.length} job${list.length > 1 ? "s" : ""}`)),
        list.map(bookingCard))));
  }

  function bookingCard(b) {
    const mapUrl = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(b.address);
    const details = b.consultation
      ? [b.serviceName, "Free consultation"]
      : [b.serviceName, `${b.bedrooms} bed, ${b.bathrooms} bath`, b.frequency !== "once" ? b.frequencyName : null];
    return h("article", { class: `bk-card is-${b.status}` },
      h("div", { class: "bk-card-time" }, h("strong", {}, fmtTime(b.start_min)), h("span", {}, "to " + fmtTime(b.end_min))),
      h("div", { class: "bk-card-main" },
        h("div", { class: "bk-card-name" },
          h("strong", {}, b.name),
          b.status !== "confirmed" ? h("span", { class: `status status-${b.status}` }, b.status) : null),
        h("p", {}, details.filter(Boolean).join(" · ")),
        b.addonNames.length ? h("p", { class: "muted" }, "Add-ons: " + b.addonNames.join(", ")) : null,
        h("p", { class: "bk-card-contact" },
          h("a", { href: mapUrl, target: "_blank", rel: "noopener noreferrer" }, b.address), " · ",
          h("a", { href: "tel:" + b.phone.replace(/[^\d+]/g, "") }, b.phone), " · ",
          h("a", { href: "mailto:" + b.email }, b.email)),
        b.notes ? h("p", { class: "bk-card-notes" }, b.notes) : null),
      h("div", { class: "bk-card-side" }, h("strong", { class: "bk-card-price" }, b.consultation ? "Consult" : money(b.price)), cardActions(b)));
  }

  function cardActions(b) {
    const wrap = h("div", { class: "bk-card-actions" });
    const btn = (label, cls, onclick) => h("button", { type: "button", class: `btn btn-sm ${cls}`, onclick }, label);
    if (b.status === "confirmed") {
      wrap.append(
        btn("Mark done", "btn-ghost", () => setStatus(b, "completed")),
        btn("Cancel", "btn-danger", () => askCancel(b, wrap)));
    } else {
      wrap.append(btn(b.status === "cancelled" ? "Restore" : "Undo done", "btn-ghost", () => setStatus(b, "confirmed")));
    }
    return wrap;
  }

  function askCancel(b, wrap) {
    const notify = h("input", { type: "checkbox", checked: true });
    wrap.replaceChildren(
      h("label", { class: "check" }, notify, "Email the client"),
      h("button", { type: "button", class: "btn btn-sm btn-danger", onclick: () => setStatus(b, "cancelled", notify.checked) }, "Yes, cancel it"),
      h("button", { type: "button", class: "btn btn-sm btn-ghost", onclick: () => renderBookings() }, "Keep"));
  }

  async function setStatus(b, status, notify = false) {
    try {
      await Admin.api(`/api/admin/bookings/${b.id}/status`, { method: "POST", body: JSON.stringify({ status, notify }) });
      Admin.toast({ completed: "Marked as done.", cancelled: "Booking cancelled.", confirmed: "Booking restored." }[status]);
      await loadBookings();
    } catch (err) {
      if (err.status !== 401) Admin.toast(err.message, true);
    }
  }

  // Keep the list fresh if the dashboard is left open.
  setInterval(() => {
    const onBookings = !$("dash").hidden && !document.querySelector('[data-panel="bookings"]').hidden;
    const confirming = document.querySelector(".bk-card-actions .check");
    if (onBookings && !document.hidden && !confirming) loadBookings().catch(() => {});
  }, 2 * 60 * 1000);
})();
