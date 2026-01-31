export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).json({ ok: true });
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  // --- helpers
  const safeJson = (value) => {
    if (value && typeof value === "object") return value;
    if (typeof value !== "string") return {};
    try { return JSON.parse(value); } catch { return {}; }
  };

  const isValidYMD = (s) => {
    if (typeof s !== "string") return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const t = Date.parse(`${s}T00:00:00Z`);
    if (Number.isNaN(t)) return false;
    // reject impossible dates like 2026-04-31
    const back = new Date(t).toISOString().slice(0, 10);
    return back === s;
  };

  const body = safeJson(req.body);

  // IMPORTANT: accept both number and string
  const offer_upgrade_id = Number(body.offer_upgrade_id);
  const from = body.from;
  const to = body.to;

  if (!Number.isFinite(offer_upgrade_id) || offer_upgrade_id <= 0 || !isValidYMD(from) || !isValidYMD(to)) {
    console.log("[calendar] Invalid input", { offer_upgrade_id: body.offer_upgrade_id, from, to });
    return res.status(200).json({ available_days: [] });
  }

  // --- fetch raw data from Xano
  const rawUrl = process.env.XANO_RAW_URL;
  if (!rawUrl) {
    console.log("[calendar] Missing XANO_RAW_URL env");
    return res.status(500).json({ error: "Server misconfigured" });
  }

  const headers = { "Content-Type": "application/json" };
  if (process.env.XANO_API_KEY) headers["Authorization"] = `Bearer ${process.env.XANO_API_KEY}`;

  let raw;
  try {
    const r = await fetch(rawUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ offer_upgrade_id, from, to }),
    });
    raw = await r.json();
  } catch (e) {
    console.log("[calendar] Xano fetch failed", e?.message || e);
    return res.status(200).json({ available_days: [] });
  }

  const book = Array.isArray(raw?.book) ? raw.book : [];
  const offer_timeslot = Array.isArray(raw?.offer_timeslot) ? raw.offer_timeslot : [];

  // default capacity from SlotLimit (if present anywhere)
  const defaultLimit =
    book.find((b) => b?.SlotLimit && typeof b.SlotLimit?.Limit === "number")?.SlotLimit?.Limit ?? 0;

  // active timeslots with capacity
  const activeTimeslots = offer_timeslot
    .filter((ot) => ot && ot.active === true && Number.isFinite(Number(ot.timeslot_id)))
    .map((ot) => ({
      timeslot_id: Number(ot.timeslot_id),
      // capacity_override wins, otherwise fallback to SlotLimit.Limit
      capacity: Number(ot.capacity_override) > 0 ? Number(ot.capacity_override) : Number(defaultLimit),
    }))
    .filter((x) => x.capacity > 0);

  if (activeTimeslots.length === 0) {
    console.log("[calendar] No active timeslots with capacity", { offer_upgrade_id, defaultLimit });
    return res.status(200).json({ available_days: [] });
  }

  const fromTs = Date.parse(`${from}T00:00:00Z`);
  const toTs = Date.parse(`${to}T00:00:00Z`);

  // group confirmed bookings by date
  const bookingsByDate = new Map();
  for (const b of book) {
    if (!b) continue;
    const status = String(b.status || "").toUpperCase();
    if (status !== "CONFIRMED") continue;
    const ts = Number(b.timestamp);
    const timeslotId = Number(b.timeslot_id);
    if (!Number.isFinite(ts) || !Number.isFinite(timeslotId)) continue;
    if (ts < fromTs || ts > toTs + 86400000) continue;

    const dayKey = new Date(ts).toISOString().slice(0, 10);
    if (!bookingsByDate.has(dayKey)) bookingsByDate.set(dayKey, []);
    bookingsByDate.get(dayKey).push({ timeslot_id: timeslotId });
  }

  // compute availability day-by-day
  const available_days = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);

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

  console.log("[calendar] OK", { offer_upgrade_id, days: available_days.length });
  return res.status(200).json({ available_days });
}
