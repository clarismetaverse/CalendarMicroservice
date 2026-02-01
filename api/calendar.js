export default async function handler(req, res) {
  // ✅ CORS
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
    const body = req.body || {};
    const book = Array.isArray(body.book) ? body.book : [];
    const offer_timeslot = Array.isArray(body.offer_timeslot) ? body.offer_timeslot : [];

    // ✅ from/to possono arrivare come "2026-01-01" oppure 1767225600000
    const parseToDate = (v) => {
      if (typeof v === "number" && Number.isFinite(v)) return new Date(v);
      if (typeof v === "string") {
        // se è "YYYY-MM-DD" lo forziamo a mezzanotte UTC
        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T00:00:00Z`);
        const d = new Date(v);
        if (!Number.isNaN(d.getTime())) return d;
      }
      return null;
    };

    const start = parseToDate(body.from);
    const end = parseToDate(body.to);

    if (!start || !end) {
      return res.status(400).json({ error: "Invalid input payload" });
    }

    const activeTimeslotIds = new Set(
      offer_timeslot
        .filter((o) => o && o.active)
        .map((o) => o.timeslot_id)
        .filter((id) => Number.isFinite(id))
    );

    if (activeTimeslotIds.size === 0) {
      return res.status(200).json({ available_days: [] });
    }

    // group bookings by day (YYYY-MM-DD)
    const bookingsByDay = new Map();

    for (const b of book) {
      if (!b) continue;
      if (b.status !== "CONFIRMED" && b.status !== "confirmed") continue;
      if (!Number.isFinite(b.timestamp)) continue;
      if (!Number.isFinite(b.timeslot_id)) continue;
      if (!activeTimeslotIds.has(b.timeslot_id)) continue;

      const day = new Date(b.timestamp).toISOString().slice(0, 10);
      if (!bookingsByDay.has(day)) bookingsByDay.set(day, []);
      bookingsByDay.get(day).push(b);
    }

    const available_days = [];

    for (
      let d = new Date(start);
      d <= end;
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      const day = d.toISOString().slice(0, 10);
      const bookingsForDay = bookingsByDay.get(day) || [];

      // ✅ regola semplice: slot liberi = #timeslot attivi - bookings del giorno
      const remaining = activeTimeslotIds.size - bookingsForDay.length;

      if (remaining > 0) {
        available_days.push({
          date: day,
          available: true,
          remaining_slots: remaining,
        });
      }
    }

    return res.status(200).json({ available_days });
  } catch (err) {
    console.error("[calendar] error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
