// Starting values used the very first time the site runs.
// After that, everything here is changed from the dashboard (yoursite.com/admin),
// so there's normally no need to edit this file.
module.exports = {
  business: {
    name: "Tidosity Premium Cleaning Services",
    phone: "",
    email: "",
    area: [],
    timezone: "America/Chicago",
  },

  pricingNote: "2-hour minimum, plus a transportation fee. Final price confirmed before your clean.",

  // A 1-bedroom / 1-bathroom home costs `base` and takes `baseMinutes`.
  // Each extra bedroom or bathroom adds its price and minutes on top.
  // `consultation: true` services are booked as a free consultation (no price shown).
  services: [
    {
      id: "residential", name: "Private Residential Cleaning", visible: true, recurring: true, consultation: false,
      description: "Maintain a fresh, spotless, and welcoming home with recurring or one-time cleanings designed around your lifestyle and needs.",
      photo: "/images/service-residential.jpg",
      base: 80, perBed: 20, perBath: 20, baseMinutes: 120, perBedMinutes: 30, perBathMinutes: 30,
    },
    {
      id: "move", name: "Move-In/Out Cleaning", visible: true, recurring: false, consultation: false,
      description: "Start fresh or leave it spotless. Detailed top-to-bottom cleanings that get every space ready for its next chapter.",
      photo: "/images/service-move.jpg",
      base: 130, perBed: 30, perBath: 30, baseMinutes: 120, perBedMinutes: 45, perBathMinutes: 45,
    },
    {
      id: "deep", name: "Organization & Deep Cleaning", visible: true, recurring: false, consultation: false,
      description: "Perfect for seasonal refreshes or spaces that need extra attention and organizing. Our deep cleaning reaches the areas standard cleanings miss.",
      photo: "/images/service-organization.jpg",
      base: 130, perBed: 30, perBath: 30, baseMinutes: 120, perBedMinutes: 45, perBathMinutes: 45,
    },
    {
      id: "rental", name: "Short-Term Rental Turnover", visible: true, recurring: false, consultation: true,
      description: "Fast, efficient turnovers that keep your property guest-ready, with damage documentation, inventory checks, and optional restocking.",
      photo: "/images/service-rental.jpg",
      base: 0, perBed: 0, perBath: 0, baseMinutes: 30, perBedMinutes: 0, perBathMinutes: 0,
    },
    {
      id: "office", name: "Office & Studio Cleaning", visible: true, recurring: false, consultation: true,
      description: "Keep your workplace clean, organized, and professional with dependable service for offices, studios, and shared workspaces.",
      photo: "/images/service-office.jpg",
      base: 0, perBed: 0, perBath: 0, baseMinutes: 30, perBedMinutes: 0, perBathMinutes: 0,
    },
  ],

  // Optional extras, e.g. { id: "oven", name: "Inside oven", price: 30, minutes: 30 }
  addons: [],

  // Recurring discounts (0.1 = 10% off). Only for services with `recurring: true`.
  frequencies: [
    { id: "once",     name: "One-time",      discount: 0 },
    { id: "weekly",   name: "Weekly",        discount: 0 },
    { id: "biweekly", name: "Every 2 weeks", discount: 0 },
    { id: "monthly",  name: "Monthly",       discount: 0 },
  ],

  maxBedrooms: 6,
  maxBathrooms: 5,

  reviews: [
    { name: "Ram", label: "Tidosity client", text: "I needed an emotional cleansing starting with my closet. I was very satisfied and the declutter was absolutely incredible!" },
    { name: "Moni", label: "Tidosity client", text: "I am very pleased with the thorough cleaning and attention to detail. Thank you!" },
  ],

  faq: [
    { q: "How is pricing calculated?", a: "Each service has a starting price based on your home size, with a 2-hour minimum plus a transportation fee. You'll see your estimate when you book, and we confirm the final price before your clean." },
    { q: "Do you offer recurring cleanings?", a: "Yes. Choose weekly, every two weeks, or monthly when you book a residential cleaning, or book a one-time clean whenever you need it." },
    { q: "Do you work with Airbnb and short-term rental hosts?", a: "Yes, it's one of our specialties. We handle turnover cleaning, final guest-readiness inspections, restocking, inventory tracking, and photo documentation. Book a free consultation and we'll build a plan around your property." },
    { q: "How do I get a quote for a rental or office?", a: "Choose Short-Term Rental Turnover or Office & Studio in the booking form to schedule a free consultation. We'll learn about your space and send you a custom plan and quote." },
    { q: "How do I reschedule or cancel?", a: "Your booking confirmation includes a link to manage your appointment, where you can reschedule or cancel online. Close to your appointment time, please give us a call." },
    { q: "Do I need to be home?", a: "Not necessarily. Many clients leave a key or door code. Just add instructions in the notes when you book." },
  ],

  defaultSettings: {
    hours: {                      // 0 = Sunday ... 6 = Saturday; null = closed
      0: null,
      1: { start: "08:00", end: "17:00" },
      2: { start: "08:00", end: "17:00" },
      3: { start: "08:00", end: "17:00" },
      4: { start: "08:00", end: "17:00" },
      5: { start: "08:00", end: "17:00" },
      6: { start: "09:00", end: "14:00" },
    },
    slotInterval: 30,
    bufferMinutes: 30,
    minNoticeHours: 24,
    maxDaysAhead: 60,
    cancelCutoffHours: 24,
    capacity: 1,
  },
};
