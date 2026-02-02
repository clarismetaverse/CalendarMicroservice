// /api/calendar.js  (Vercel Function - CommonJS)

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // body safe (a volte arriva stringa)
    const body =
      req.body && typeof req.body === "string"
        ? JSON.parse(req.body)
        : (req.body || {});

    const { book = [], offer_timeslot = [], from, to } = body;

    if (!from || !to) {
      return res.status(400).json({ error: "Invalid input payload" });
    }

    const activeTimeslotIds = new Set(
      (offer_timeslot || [])
        .filter((o) => o && o.active)
        .map((o) => o.timeslot_id)
        .filter((id) => Number.isFinite(id))
    );

    if (activeTimeslotIds.size === 0) {
      return res.status(200).json({ available_days: [] });
    }

    // group bookings by day (YYYY-MM-DD)
    const bookingsByDay = new Map();

    for (const b of book || []) {
      if (!b) continue;
      if (b.status !== "CONFIRMED") continue;
      if (!activeTimeslotIds.has(b.timeslot_id)) continue;
      if (!Number.isFinite(b.timestamp)) continue;

      const day = new Date(b.timestamp).toISOString().slice(0, 10);
      if (!bookingsByDay.has(day)) bookingsByDay.set(day, []);
      bookingsByDay.get(day).push(b);
    }

    const available_days = [];
    const start = new Date(from);
    const end = new Date(to);

    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const day = d.toISOString().slice(0, 10);
      const bookingsForDay = bookingsByDay.get(day) || [];

      // se c'è ALMENO 1 slot libero → disponibile
      if (bookingsForDay.length < activeTimeslotIds.size) {
        available_days.push({
          date: day,
          available: true,
          remaining_slots: activeTimeslotIds.size - bookingsForDay.length,
        });
      }
    }

    return res.status(200).json({ available_days });
  } catch (err) {
    console.error("[calendar] error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
