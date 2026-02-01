export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(200).json({ ok: true });
  }

  // Healthcheck (quando apri da browser)
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, message: "calendar microservice live" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Body parser super safe
  const parseBody = (value) => {
    if (!value) return {};
    if (typeof value === "object") return value; // già JSON
    if (typeof value === "string") {
      try { return JSON.parse(value); } catch { return {}; }
    }
    return {};
  };

  const body = parseBody(req.body);

  // Helpers date
  const toDayStartUtcMs = (v) => {
    // accetta "YYYY-MM-DD" oppure timestamp ms
    if (typeof v === "number" && Number.isFinite(v)) {
      const d = new Date(v);
      return Date.parse(d.toISOString().slice(0, 10) + "T00:00:00Z");
    }
    if (typeof v === "string") {
      // se è già ISO day "YYYY-MM-DD"
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return Date.parse(v + "T00:00:00Z");
      // altrimenti prova Date.parse
      const t = Date.parse(v);
      if (!Number.isNaN(t)) {
        const d = new Date(t);
        return Date.parse(d.toISOString().slice(0, 10) + "T00:00:00Z");
      }
    }
    return NaN;
  };

  const offer_upgrade_id = Number(body.offer_upgrade_id);
  const fromMs = toDayStartUtcMs(body.from);
  const toMs = toDayStartUtcMs(body.to);

  if (!Number.isFinite(offer_upgrade_id) || Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    // IMPORTANT: niente 400 “rumorosi”, ti ritorno vuoto ma loggo
    console.log("[calendar] Missing/invalid required fields", {
      offer_upgrade_id: body.offer_upgrade_id,
      from: body.from,
      to: body.to,
    });
    return res.status(200).json({ available_days: [] });
  }

  const book = Array.isArray(body.book) ? body.book : (Array.isArray(body.bookings) ? body.bookings : []);
  const offer_timeslot = Array.isArray(body.offer_timeslot) ? body.offer_timeslot : [];

  // active timeslots + capacity
  // default capacity = 1 se non hai capacity_override/capacity
  const activeSlots = offer_timeslot
    .filter((o) => o && o.active)
    .map((o) => ({
      timeslot_id: Number(o.timeslot_id),
      capacity:
        (Number(o.capacity_override) > 0 ? Number(o.capacity_override) :
        (Number(o.capacity) > 0 ? Number(o.capacity) : 1)),
    }))
    .filter((o) => Number.isFinite(o.timeslot_id));

  if (activeSlots.length === 0) {
    console.log("[calendar] No active timeslots for offer", offer_upgrade_id);
    return res.status(200).json({ available_days: [] });
  }

  // Group bookings by YYYY-MM-DD
  const bookingsByDay = new Map();

  for (const b of book) {
    if (!b) continue;

    const status = String(b.status || "");
    if (status !== "CONFIRMED" && status !== "confirmed") continue;

    const ts = Number(b.timestamp);
    const timeslotId = Number(b.timeslot_id);

    if (!Number.isFinite(ts) || !Number.isFinite(timeslotId)) continue;
    if (ts < fromMs || ts > (toMs + 86400000 - 1)) continue; // include fine giornata

    // considera solo timeslot attivi
    if (!activeSlots.some((s) => s.timeslot_id === timeslotId)) continue;

    const day = new Date(ts).toISOString().slice(0, 10);
    if (!bookingsByDay.has(day)) bookingsByDay.set(day, []);
    bookingsByDay.get(day).push({ timeslot_id: timeslotId });
  }

  const available_days = [];

  for (let cursor = fromMs; cursor <= toMs; cursor += 86400000) {
    const day = new Date(cursor).toISOString().slice(0, 10);
    const dayBookings = bookingsByDay.get(day) || [];

    // count used per timeslot
    const used = new Map();
    for (const b of dayBookings) {
      used.set(b.timeslot_id, (used.get(b.timeslot_id) || 0) + 1);
    }

    let maxRemaining = 0;
    for (const s of activeSlots) {
      const remaining = s.capacity - (used.get(s.timeslot_id) || 0);
      if (remaining > maxRemaining) maxRemaining = remaining;
    }

    if (maxRemaining > 0) {
      available_days.push({ date: day, available: true, remaining_slots: maxRemaining });
    }
  }

  return res.status(200).json({ available_days });
}
