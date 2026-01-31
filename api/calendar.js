export default async function handler(req, res) {
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

  // Accept offer_upgrade_id as number or numeric string
  const offer_upgrade_id =
    Number.isFinite(body.offer_upgrade_id)
      ? body.offer_upgrade_id
      : (typeof body.offer_upgrade_id === "string" && body.offer_upgrade_id.trim() !== "")
        ? Number(body.offer_upgrade_id)
        : null;

  // Accept from/to as ISO string ("2026-01-01") OR timestamp ms (number)
  const fromIso = typeof body.from === "string" ? body.from : null;
  const toIso = typeof body.to === "string" ? body.to : null;

  const fromTs =
    Number.isFinite(body.from)
      ? body.from
      : (fromIso ? Date.parse(`${fromIso}T00:00:00Z`) : NaN);

  const toTs =
    Number.isFinite(body.to)
      ? body.to
      : (toIso ? Date.parse(`${toIso}T00:00:00Z`) : NaN);

  if (!offer_upgrade_id || Number.isNaN(fromTs) || Number.isNaN(toTs)) {
    console.log("[calendar] Missing/invalid required fields", {
      offer_upgrade_id,
      from: body.from,
      to: body.to,
    });
    return res.status(200).json({ available_days: [] });
  }

  // arrays
  const book = Array.isArray(body.book) ? body.book : [];
  const offerTimeslot = Array.isArray(body.offer_timeslot) ? body.offer_timeslot : [];

  // Capacity logic:
  // - prefer capacity_override (Xano column)
  // - fallback to capacity (if present)
  // - fallback defaultCapacity (1)
  const defaultCapacity = 1;

  const activeTimeslots = offerTimeslot
    .filter((slot) => slot && slot.active === true)
    .map((slot) => {
      const cap =
        Number.isFinite(slot.capacity_override) ? slot.capacity_override
        : Number.isFinite(slot.capacity) ? slot.capacity
        : defaultCapacity;

      return {
        timeslot_id: slot.timeslot_id,
        capacity: cap > 0 ? cap : defaultCapacity,
      };
    })
    .filter((slot) => Number.isFinite(slot.timeslot_id));

  if (activeTimeslots.length === 0) {
    console.log("[calendar] No active timeslots after parsing");
    return res.status(200).json({ available_days: [] });
  }

  // group bookings by day (YYYY-MM-DD)
  const bookingsByDate = new Map();

  for (const booking of book) {
    if (!booking) continue;

    const status = booking.status;
    if (status !== "CONFIRMED" && status !== "confirmed") continue;

    const ts = booking.timestamp;
    if (!Number.isFinite(ts)) continue;

    const tid = booking.timeslot_id;
    if (!Number.isFinite(tid)) continue;

    if (ts < fromTs || ts > (toTs + 86400000)) continue;

    const dayKey = new Date(ts).toISOString().slice(0, 10);
    if (!bookingsByDate.has(dayKey)) bookingsByDate.set(dayKey, []);
    bookingsByDate.get(dayKey).push({ timeslot_id: tid });
  }

  // iterate day by day
  const start = new Date(fromTs);
  start.setUTCHours(0, 0, 0, 0);

  const end = new Date(toTs);
  end.setUTCHours(0, 0, 0, 0);

  const available_days = [];

  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    const dayBookings = bookingsByDate.get(date) || [];

    const usedByTimeslot = new Map();
    for (const b of dayBookings) {
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

  console.log("[calendar] OK", {
    offer_upgrade_id,
    fromTs,
    toTs,
    activeTimeslots: activeTimeslots.length,
    days: available_days.length,
  });

  return res.status(200).json({ available_days });
}
