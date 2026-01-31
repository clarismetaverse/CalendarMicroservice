export default async function handler(req, res) {
  // CORS
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

  // ---- helpers
  const safeJson = (value) => {
    if (value && typeof value === "object") return value;
    if (typeof value !== "string") return {};
    try {
      return JSON.parse(value);
    } catch (e) {
      console.log("[calendar] Invalid JSON body:", e?.message || e);
      return {};
    }
  };

  const toInt = (v) => {
    if (Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
    return null;
  };

  const toDateMs = (v) => {
    // Accept ISO "2026-01-01" OR ms timestamp
    if (Number.isFinite(v)) return v;
    if (typeof v === "string") {
      // if it's numeric string
      if (v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
      // ISO date
      const ms = Date.parse(`${v}T00:00:00Z`);
      return Number.isNaN(ms) ? null : ms;
    }
    return null;
  };

  // ---- read body + fallback query
  const body = safeJson(req.body);
  const q = req.query || {};

  const offer_upgrade_id = toInt(body.offer_upgrade_id ?? q.offer_upgrade_id);
  const fromMs = toDateMs(body.from ?? q.from);
  const toMs = toDateMs(body.to ?? q.to);

  if (!offer_upgrade_id || !fromMs || !toMs) {
    console.log("[calendar] Missing required fields", {
      offer_upgrade_id,
      from: body.from ?? q.from ?? null,
      to: body.to ?? q.to ?? null,
    });
    return res.status(200).json({ available_days: [] });
  }

  // arrays
  const book = Array.isArray(body.book) ? body.book : [];
  const offer_timeslot = Array.isArray(body.offer_timeslot) ? body.offer_timeslot : [];

  // Active timeslots:
  // - uses capacity_override if present
  // - else defaultCapacity = 1
  const defaultCapacity = Number.isFinite(body.default_capacity) ? body.default_capacity : 1;

  const activeTimeslots = offer_timeslot
    .filter((s) => s && s.active === true)
    .map((s) => {
      const timeslot_id = toInt(s.timeslot_id);
      const cap =
        Number.isFinite(s.capacity_override) && s.capacity_override > 0
          ? s.capacity_override
          : Number.isFinite(s.capacity) && s.capacity > 0
          ? s.capacity
          : defaultCapacity;

      return { timeslot_id, capacity: cap };
    })
    .filter((s) => Number.isFinite(s.timeslot_id) && s.capacity > 0);

  if (activeTimeslots.length === 0) {
    console.log("[calendar] No active timeslots (or all capacity=0)", {
      offer_upgrade_id,
      offer_timeslot_len: offer_timeslot.length,
      defaultCapacity,
    });
    return res.status(200).json({ available_days: [] });
  }

  // Group bookings by date key (YYYY-MM-DD)
  const bookingsByDate = new Map();
  for (const b of book) {
    if (!b) continue;
    const status = (b.status || "").toString().toLowerCase();
    if (status !== "confirmed") continue;

    const ts = toDateMs(b.timestamp);
    const timeslot_id = toInt(b.timeslot_id);
    if (!Number.isFinite(ts) || !Number.isFinite(timeslot_id)) continue;

    // keep only in [fromMs, toMs] inclusive
    if (ts < fromMs || ts > toMs + 86399999) continue;

    const dayKey = new Date(ts).toISOString().slice(0, 10);
    if (!bookingsByDate.has(dayKey)) bookingsByDate.set(dayKey, []);
    bookingsByDate.get(dayKey).push({ timeslot_id });
  }

  // Compute availability day by day
  const available_days = [];
  const cursor = new Date(fromMs);
  const end = new Date(toMs);

  for (; cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
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

  console.log("[calendar] OK", { offer_upgrade_id, days: available_days.length });
  return res.status(200).json({ available_days });
}
