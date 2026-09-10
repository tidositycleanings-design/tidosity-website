// Shared price + duration calculator. Loaded by the booking widget in the
// browser AND required by the server, which recalculates every booking so a
// price can't be tampered with from the page.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Pricing = factory();
})(typeof self !== "undefined" ? self : this, function () {
  function clampInt(value, min, max) {
    const n = parseInt(value, 10);
    if (Number.isNaN(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  // cfg: { services, addons, frequencies, maxBedrooms, maxBathrooms }
  // sel: { service, bedrooms, bathrooms, addons: [ids], frequency }
  function quote(cfg, sel) {
    const service = cfg.services.find((s) => s.id === sel.service);
    if (!service) return null;

    // Consultation services: a fixed-length free visit/call; the quote comes afterwards.
    if (service.consultation) {
      return {
        service: service.id, serviceName: service.name, consultation: true,
        bedrooms: 1, bathrooms: 1, addons: [], addonNames: [],
        frequency: cfg.frequencies[0].id, frequencyName: cfg.frequencies[0].name,
        discount: 0, price: 0, minutes: service.baseMinutes || 30,
      };
    }

    const beds = clampInt(sel.bedrooms, 1, cfg.maxBedrooms);
    const baths = clampInt(sel.bathrooms, 1, cfg.maxBathrooms);
    const addons = cfg.addons.filter((a) => (sel.addons || []).includes(a.id));
    const freq = (service.recurring && cfg.frequencies.find((f) => f.id === sel.frequency)) || cfg.frequencies[0];

    let price = service.base + service.perBed * (beds - 1) + service.perBath * (baths - 1);
    let minutes = service.baseMinutes + service.perBedMinutes * (beds - 1) + service.perBathMinutes * (baths - 1);

    // Recurring discount applies to the clean itself, not to add-ons.
    const discount = Math.round(price * freq.discount);
    price -= discount;
    for (const a of addons) {
      price += a.price;
      minutes += a.minutes;
    }
    minutes = Math.ceil(minutes / 15) * 15;

    return {
      service: service.id,
      serviceName: service.name,
      consultation: false,
      bedrooms: beds,
      bathrooms: baths,
      addons: addons.map((a) => a.id),
      addonNames: addons.map((a) => a.name),
      frequency: freq.id,
      frequencyName: freq.name,
      discount,
      price,
      minutes,
    };
  }

  function formatDuration(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    const parts = [];
    if (h) parts.push(h + (h === 1 ? " hr" : " hrs"));
    if (m) parts.push(m + " min");
    return parts.join(" ");
  }

  return { quote, formatDuration };
});
