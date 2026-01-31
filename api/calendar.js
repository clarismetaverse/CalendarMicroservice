export default async function handler(req, res) {
  // --- CORS ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).json({ ok: true });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // --- parse body safely ---
  const safeJson = (value) => {
    if (value && typeof value === "object") return value;
    if (typeof value !== "string") return {};
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  };

  const body = safeJson(req.body);

  const offer_upgrade_id = Number(body.offer_upgrade_id);
  const from = typeof body.from === "string" ? body.from : null;
  const to = typeof body.to === "string" ? body.to : null;

  if (!offer_upgrade_id || !from || !to) {
    return res.status(200).json({ available_days: [] });
  }

  const fromTs = Date.parse(`${from}T00:00:00Z`);
  const toTs = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(fromTs) || Number.isNaN(toTs)) {
    return res.status(200).json({ available_days: [] });
  }

  const book = Array.isArray(body.book) ? body.book : [];
  const offerTimeslot = Array.isArray(body.offer_timeslot) ? body.offer_timeslot : [];

  // --- capacity fallback chain ---
  const capacityFromBody = Number(body.default_capacity); // opzionale
  const capacityFromSlotLimit =
    Number(body?.SlotLimit?.Limit) ||
    Number(body?.slot_limit?.Limit) ||
    Number(book.find((b) => b?.SlotLimit && typeof b.SlotLimit.Limit === "number")?.SlotLimit?.Limit) ||
    0;

  const fallbackCapacity = capacityFromBody > 0 ? capacityFromBody : (capacityFromSlotLimit > 0 ? capacityFromSlotLimit : 1);

  // --- active timeslots (support capacity_override) ---
  const activeTimeslots = offerTimeslot
    .filter((slot) => slot && slot.active)
    .map((slot) => {
      const timeslot_id = Number(slot.timeslot_id);

      const override = Number(slot.capacity_override);
      const capacity =
        override > 0 ? override :
        (Number(slot.capacity) > 0 ? Number(slot.capacity) : fallbackCapacity);

      return { timeslot_id, capacity };
    })
    .filter((s) => Number.isFinite(s.timeslot_id) && s.timeslot_id > 0 && s.capacity > 0);

  if (activeTimeslots.length === 0) {
    return res.status(200).json({ available_days: [] });
  }

  // --- group bookings by date (only confirmed + in range) ---
  const bookingsByDate = new Map();

  for (const booking of book) {
    if (!booking) continue;

    const status = booking.status;
    if (status !== "CONFIRMED" && status !== "confirmed") continue;

    const ts = Number(booking.timestamp);
    const timeslot_id = Number(booking.timeslot_id);

    if (!Number.isFinite(ts) || !Number.isFinite(timeslot_id)) continue;
    if (ts < fromTs || ts > toTs + 86400000) continue;

    const dayKey = new Date(ts).toISOString().slice(0, 10);
    if (!bookingsByDate.has(dayKey)) bookingsByDate.set(dayKey, []);
    bookingsByDate.get(dayKey).push({ timeslot_id });
  }

  // --- compute availability (max remaining over active timeslots) ---
  const available_days = [];
  const startDate = new Date(`${from}T00:00:00Z`);
  const endDate = new Date(`${to}T00:00:00Z`);

  for (let cursor = new Date(startDate); cursor <= endDate; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    const dateBookings = bookingsByDate.get(date) || [];

    const usedByTimeslot = new Map();
    for (const b of dateBookings) {
      usedByTimeslot.set(b.timeslot_id, (usedByTimeslot.get(b.timeslot_id) || 0) + 1);
    }

    let maxRemaining = 0;
    for (const slot of activeTimeslots) {
      const used = usedByTimeslot.get(slot.timeslot_id) || 0;
      const remaining = slot.capacity - used;
      if (remaining > maxRemaining) maxRemaining = remaining;
    }

    if (maxRemaining > 0) {
      available_days.push({ date, available: true, remaining_slots: maxRemaining });
    }
  }

  return res.status(200).json({ available_days });
}
