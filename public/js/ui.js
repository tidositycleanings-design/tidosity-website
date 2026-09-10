// Small shared helpers + the calendar/time picker used by the booking widget
// (homepage) and the reschedule page (manage.html).
(function () {
  // h("button", { class: "x", onclick: fn }, "text", childNode) -> element
  function h(tag, props, ...kids) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (key === "class") node.className = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else if (value === true) node.setAttribute(key, "");
      else if (value !== false && value != null) node.setAttribute(key, value);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid);
    return node;
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || "Something went wrong. Please try again.");
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const money = (n) => "$" + Number(n).toLocaleString("en-US");
  function fmtTime(min) {
    const hr = Math.floor(min / 60);
    return `${hr % 12 || 12}:${String(min % 60).padStart(2, "0")} ${hr >= 12 ? "PM" : "AM"}`;
  }
  const fmtDate = (date, opts) =>
    new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
  function addDays(date, n) {
    const d = new Date(date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function shiftMonth(month, n) {
    const [y, m] = month.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
  }

  // Calendar + time slots.
  // opts: { minutes, today, maxDaysAhead, exclude (booking token), onSelect(date, start|null) }
  function SlotPicker(container, opts) {
    const st = { month: null, days: {}, date: null, start: null, minutes: opts.minutes };
    const minMonth = opts.today.slice(0, 7);
    const maxMonth = addDays(opts.today, opts.maxDaysAhead).slice(0, 7);

    const cal = h("div", { class: "calendar" });
    const label = h("p", { class: "bk-times-label", "aria-live": "polite" });
    const slotsBox = h("div", { class: "bk-slots", role: "group", "aria-label": "Available start times" });
    container.replaceChildren(cal, h("div", { class: "bk-times" }, label, slotsBox));

    const query = (extra) => {
      const q = new URLSearchParams({ minutes: st.minutes, ...extra });
      if (opts.exclude) q.set("exclude", opts.exclude);
      return q.toString();
    };

    function resetTimes() {
      label.textContent = "Choose a day to see open times.";
      slotsBox.replaceChildren();
    }

    function renderCalendar() {
      const [y, m] = st.month.split("-").map(Number);
      const first = new Date(Date.UTC(y, m - 1, 1));
      const move = (n) => () => { st.month = shiftMonth(st.month, n); loadMonth(); };
      const grid = h("div", { class: "cal-grid" },
        ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => h("span", { class: "cal-dow", "aria-hidden": "true" }, d)),
        Array.from({ length: first.getUTCDay() }, () => h("span")));

      for (let d = st.month + "-01"; d.startsWith(st.month); d = addDays(d, 1)) {
        const open = st.days[d] || 0;
        const cls = ["cal-day", open && "has-slots", d === opts.today && "is-today", d === st.date && "is-selected"];
        grid.append(h("button", {
          type: "button",
          class: cls.filter(Boolean).join(" "),
          disabled: !open,
          "aria-pressed": String(d === st.date),
          "aria-label": fmtDate(d, { weekday: "long", month: "long", day: "numeric" }) + (open ? "" : ", no openings"),
          onclick: () => pickDate(d),
        }, String(Number(d.slice(8)))));
      }

      cal.replaceChildren(
        h("div", { class: "cal-head" },
          h("button", { type: "button", class: "cal-nav", "aria-label": "Previous month", disabled: st.month <= minMonth, onclick: move(-1) }, "‹"),
          h("strong", {}, first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })),
          h("button", { type: "button", class: "cal-nav", "aria-label": "Next month", disabled: st.month >= maxMonth, onclick: move(1) }, "›")),
        grid);
    }

    async function loadMonth() {
      const month = st.month;
      st.days = {};
      renderCalendar();
      cal.classList.add("is-loading");
      try {
        const data = await api("/api/availability?" + query({ month }));
        if (month !== st.month) return;
        st.days = data.days;
        renderCalendar();
        // Nothing open this month? Jump ahead once so clients don't see an empty calendar.
        if (!Object.values(st.days).some(Boolean) && !st.date && st.month < maxMonth && month === minMonth) {
          st.month = shiftMonth(st.month, 1);
          return loadMonth();
        }
      } catch (err) {
        label.textContent = err.message;
      } finally {
        if (month === st.month) cal.classList.remove("is-loading");
      }
    }

    async function pickDate(date) {
      st.date = date;
      st.start = null;
      opts.onSelect(date, null);
      renderCalendar();
      label.textContent = "Loading times...";
      slotsBox.replaceChildren();
      try {
        const data = await api("/api/slots?" + query({ date }));
        if (st.date !== date) return;
        if (!data.slots.length) {
          label.textContent = `${data.label}: fully booked. Try another day.`;
          return;
        }
        label.textContent = data.label;
        slotsBox.replaceChildren(...data.slots.map((s) =>
          h("button", { type: "button", class: "slot", "aria-pressed": "false", onclick: (e) => pickSlot(s.start, e.currentTarget) }, s.label)));
      } catch (err) {
        label.textContent = err.message;
      }
    }

    function pickSlot(start, btn) {
      st.start = start;
      slotsBox.querySelectorAll(".slot").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      opts.onSelect(st.date, start);
    }

    resetTimes();
    return {
      open() {
        if (!st.month) st.month = (st.date || opts.today).slice(0, 7);
        loadMonth();
      },
      setMinutes(minutes) {
        if (minutes === st.minutes) return;
        st.minutes = minutes;
        st.date = null;
        st.start = null;
        st.month = null;
        resetTimes();
      },
      refresh() {
        const date = st.date;
        loadMonth();
        if (date) pickDate(date);
      },
    };
  }

  window.UI = { h, api, money, fmtTime, fmtDate, addDays, SlotPicker };
})();
