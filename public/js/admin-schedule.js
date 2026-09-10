// Dashboard "Schedule" tab: working hours, booking rules, and time off.
(function () {
  const { h, api } = window.UI;
  const Admin = window.Admin;
  const $ = (id) => document.getElementById(id);
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const RULES = ["bufferMinutes", "minNoticeHours", "maxDaysAhead", "cancelCutoffHours", "slotInterval", "capacity"];

  const hoursForm = $("hours-form");
  const blockForm = $("block-form");
  Admin.track(hoursForm, "schedule");

  async function load() {
    const [schedule] = await Promise.all([Admin.api("/api/admin/settings"), loadBlocks()]);
    $("hours-grid").replaceChildren(...[1, 2, 3, 4, 5, 6, 0].map((d) => {
      const hrs = schedule.hours[d];
      const open = h("input", { type: "checkbox", name: `open-${d}`, checked: Boolean(hrs) });
      const start = h("input", { type: "time", name: `start-${d}`, value: hrs ? hrs.start : "09:00", disabled: !hrs, "aria-label": `${DAYS[d]} start time` });
      const end = h("input", { type: "time", name: `end-${d}`, value: hrs ? hrs.end : "17:00", disabled: !hrs, "aria-label": `${DAYS[d]} end time` });
      const closed = h("span", { class: "closed-label" }, "Closed");
      const row = h("div", { class: "hours-row" + (hrs ? "" : " is-closed") },
        h("label", { class: "check" }, open, DAYS[d]), start, h("span", { class: "muted" }, "to"), end, closed);
      open.addEventListener("change", () => {
        start.disabled = end.disabled = !open.checked;
        row.classList.toggle("is-closed", !open.checked);
      });
      return row;
    }));
    for (const key of RULES) hoursForm.elements[key].value = schedule[key];
    Admin.saved("schedule");
  }
  Admin.panels.schedule = { load };

  hoursForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = hoursForm.elements;
    const body = { hours: {} };
    for (let d = 0; d < 7; d++) {
      body.hours[d] = f[`open-${d}`].checked ? { start: f[`start-${d}`].value, end: f[`end-${d}`].value } : null;
    }
    for (const key of RULES) body[key] = Number(f[key].value);
    $("hours-error").hidden = true;
    try {
      await Admin.api("/api/admin/settings", { method: "PUT", body: JSON.stringify(body) });
      Admin.saved("schedule");
      Admin.toast("Schedule saved. Your website shows the new hours.");
      Admin.refreshChecklist();
    } catch (err) {
      Admin.showError($("hours-error"), err);
    }
  });

  // ------------------------------------------------------------ time off
  const toggleTimes = () => blockForm.querySelectorAll("[data-times]").forEach((el) => (el.hidden = blockForm.elements.allDay.checked));
  blockForm.elements.allDay.addEventListener("change", toggleTimes);

  async function loadBlocks() {
    const [{ blocks }, cfg] = await Promise.all([Admin.api("/api/admin/blocks"), api("/api/config")]);
    blockForm.elements.date.min = cfg.today;
    blockForm.elements.endDate.min = cfg.today;
    if (!blocks.length) return $("block-list").replaceChildren(h("li", { class: "muted" }, "No time off scheduled."));
    $("block-list").replaceChildren(...blocks.map((b) =>
      h("li", {},
        h("div", {}, h("strong", {}, b.dateLabel), h("span", { class: "muted" }, b.timeLabel + (b.reason ? ` · ${b.reason}` : ""))),
        h("button", { type: "button", class: "btn btn-sm btn-ghost", "aria-label": `Remove time off on ${b.dateLabel}`, onclick: () => removeBlock(b.id) }, "Remove"))));
  }

  async function removeBlock(id) {
    try {
      await Admin.api(`/api/admin/blocks/${id}`, { method: "DELETE" });
      Admin.toast("Time off removed.");
      await loadBlocks();
    } catch (err) {
      if (err.status !== 401) Admin.toast(err.message, true);
    }
  }

  blockForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = blockForm.elements;
    $("block-error").hidden = true;
    try {
      const result = await Admin.api("/api/admin/blocks", {
        method: "POST",
        body: JSON.stringify({
          date: f.date.value, endDate: f.endDate.value || null, allDay: f.allDay.checked,
          start: f.start.value, end: f.end.value, reason: f.reason.value,
        }),
      });
      Admin.toast(`Blocked ${result.days} day${result.days > 1 ? "s" : ""}.`);
      blockForm.reset();
      toggleTimes();
      await loadBlocks();
    } catch (err) {
      Admin.showError($("block-error"), err);
    }
  });
})();
