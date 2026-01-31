export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    console.log("[calendar] OPTIONS preflight");
    return res.status(200).json({ ok: true });
  }

  if (req.method !== "POST") {
    console.log("[calendar] Method not allowed:", req.method);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const safeJson = (value) => {
    if (value && typeof value === "object") return value;
    if (typeof value !== "string") return {};
    try {
      return JSON.parse(value);
    } catch (error) {
      console.log("[calendar] Invalid JSON body:", error?.message || error);
      return {};
    }
  };

  const body = safeJson(req.body);
  const offer_upgrade_id = Number.isFinite(body.offer_upgrade_id) ? body.offer_upgrade_id : null;
  const from = typeof body.from === "string" ? body.from : null;
  const to = typeof body.to === "string" ? body.to : null;

  if (!offer_upgrade_id || !from || !to) {
    console.log("[calendar] Missing required fields", {
      offer_upgrade_id,
      from,
      to,
    });
    return res.status(200).json({ available_days: [] });
  }

  const fromTs = Date.parse(`${from}T00:00:00Z`);
  const toTs = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(fromTs) || Number.isNaN(toTs)) {
    console.log("[calendar] Invalid date range:", { from, to });
    return res.status(200).json({ available_days: [] });
  }

  const book = Array.isArray(body.book) ? body.book : [];
  const offerTimeslot = Array.isArray(body.offer_timeslot) ? body.offer_timeslot : [];

  const activeTimeslots = offerTimeslot
    .filter((slot) => slot && slot.active)
    .map((slot) => ({
      timeslot_id: slot.timeslot_id,
      capacity: Number.isFinite(slot.capacity) ? slot.capacity : 0,
    }))
    .filter((slot) => Number.isFinite(slot.timeslot_id) && slot.capacity > 0);

  if (activeTimeslots.length === 0) {
    console.log("[calendar] No active timeslots");
    return res.status(200).json({ available_days: [] });
  }

  const bookingsByDate = new Map();
  for (const booking of book) {
    if (!booking || (booking.status !== "CONFIRMED" && booking.status !== "confirmed")) continue;
    if (!Number.isFinite(booking.timestamp)) continue;
    if (!Number.isFinite(booking.timeslot_id)) continue;
    if (booking.timestamp < fromTs || booking.timestamp > toTs + 86400000) continue;
    const dayKey = new Date(booking.timestamp).toISOString().slice(0, 10);
    if (!bookingsByDate.has(dayKey)) bookingsByDate.set(dayKey, []);
    bookingsByDate.get(dayKey).push(booking);
  }

  const available_days = [];
  const startDate = new Date(`${from}T00:00:00Z`);
  const endDate = new Date(`${to}T00:00:00Z`);

  for (let cursor = new Date(startDate); cursor <= endDate; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    const dateBookings = bookingsByDate.get(date) || [];
    const usedByTimeslot = new Map();

    for (const booking of dateBookings) {
      usedByTimeslot.set(
        booking.timeslot_id,
        (usedByTimeslot.get(booking.timeslot_id) || 0) + 1
      );
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

  console.log("[calendar] Availability computed", {
    offer_upgrade_id,
    days: available_days.length,
  });

  return res.status(200).json({ available_days });
}
