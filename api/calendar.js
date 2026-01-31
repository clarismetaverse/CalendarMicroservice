export default async function handler(req, res) {
  // --- CORS ---
  res.setHeader("Access-Control-Allow-Origin", "*"); // se vuoi più sicuro, metti il dominio del tuo frontend
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Health check (utile per testare da browser)
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, message: "calendar api alive" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const body = req.body || {};
    const { offer_upgrade_id, from, to } = body;

    if (!offer_upgrade_id || !from || !to) {
      return res.status(400).json({ error: "Missing required fields: offer_upgrade_id, from, to" });
    }

    // ✅ 1) Chiama Xano RAW per ottenere book + offer_timeslot (+ timeslot nested)
    const xanoUrl = "https://xbut-eryu-hhsg.f2.xano.io/api:vGd6XDW3/calendar/raw/Data";

    const xanoResp = await fetch(xanoUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offer_upgrade_id, from, to }),
    });

    if (!xanoResp.ok) {
      const errText = await xanoResp.text();
      return res.status(502).json({ error: "Xano request failed", status: xanoResp.status, details: errText });
    }

    const raw = await xanoResp.json();

    // ✅ 2) Normalizza input per il calcolo
    // raw.book: [{ timestamp, status, timeslot_id, ... }]
    // raw.offer_timeslot: [{ timeslot_id, active, capacity_override, _timeslot:[{Start_time,End_time}]}]
    const book = raw.book || [];
    const offer_timeslot = raw.offer_timeslot || [];

    // Slot limit: prendilo dal primo booking (come facevi) oppure da dove lo salvi tu.
    const slotLimit = book.find(b => b?.SlotLimit)?.SlotLimit || null;

    const hasValidSlotLimit =
      slotLimit && slotLimit.Type && typeof slotLimit.Limit === "number" && slotLimit.Limit > 0;

    const activeTimeslotIds = new Set(
      offer_timeslot
        .filter((t) => t.offer_upgrade_id === offer_upgrade_id && t.active)
        .map((t) => t.timeslot_id)
    );

    if (!hasValidSlotLimit || activeTimeslotIds.size === 0) {
      return res.status(200).json({ available_days: [] });
    }

    // ✅ 3) Filtra bookings confermati nel range (usiamo timestamp perché è più safe)
    const fromTs = Date.parse(`${from}T00:00:00Z`);
    const toTs = Date.parse(`${to}T23:59:59Z`);
    if (Number.isNaN(fromTs) || Number.isNaN(toTs)) {
      return res.status(400).json({ error: "Invalid date range" });
    }

    const filteredBookings = book.filter((b) => {
      if (b.status !== "CONFIRMED" && b.status !== "confirmed") return false;
      if (!b.timestamp) return false;
      if (b.timestamp < fromTs || b.timestamp > toTs) return false;
      if (!activeTimeslotIds.has(b.timeslot_id)) return false;
      return true;
    });

    // Group per giorno (YYYY-MM-DD)
    const bookingsByDate = new Map();
    for (const b of filteredBookings) {
      const day = new Date(b.timestamp).toISOString().slice(0, 10);
      if (!bookingsByDate.has(day)) bookingsByDate.set(day, []);
      bookingsByDate.get(day).push(b);
    }

    const available_days = [];

    // Loop giorni
    const startDate = new Date(`${from}T00:00:00Z`);
    const endDate = new Date(`${to}T00:00:00Z`);

    for (let cursor = new Date(startDate); cursor <= endDate; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const date = cursor.toISOString().slice(0, 10);
      const dateBookings = bookingsByDate.get(date) || [];

      if (slotLimit.Type === "day") {
        const remaining = slotLimit.Limit - dateBookings.length;
        if (remaining > 0) {
          available_days.push({ date, available: true, remaining_slots: remaining });
        }
        continue;
      }

      if (slotLimit.Type === "hour") {
        const usedByTimeslot = new Map();
        for (const b of dateBookings) {
          usedByTimeslot.set(b.timeslot_id, (usedByTimeslot.get(b.timeslot_id) || 0) + 1);
        }

        let maxRemaining = 0;
        for (const id of activeTimeslotIds) {
          const used = usedByTimeslot.get(id) || 0;
          const remaining = slotLimit.Limit - used;
          if (remaining > maxRemaining) maxRemaining = remaining;
        }

        if (maxRemaining > 0) {
          available_days.push({ date, available: true, remaining_slots: maxRemaining });
        }
      }
    }

    return res.status(200).json({ available_days });
  } catch (err) {
    return res.status(500).json({ error: "Internal error", details: String(err?.message || err) });
  }
}
