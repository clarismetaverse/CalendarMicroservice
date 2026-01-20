export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { offer_id, from, to } = req.body || {};

  if (!offer_id || !from || !to) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // 1️⃣ Fetch raw data from Xano
  const response = await fetch(
    `${process.env.XANO_CALENDAR_RAW_URL}?offer_upgrade_id=${offer_id}&from=${from}&to=${to}`
  );

  if (!response.ok) {
    return res.status(500).json({ error: 'Failed to fetch data from Xano' });
  }

  const {
    bookings = [],
    offer_timeslots = [],
    timeslots = [],
    slot_limit
  } = await response.json();

  // 2️⃣ Build helpers
  const activeTimeslotIds = new Set(
    offer_timeslots
      .filter(o => o.active)
      .map(o => o.timeslot_id)
  );

  const bookingsByDate = {};
  for (const b of bookings) {
    if (!bookingsByDate[b.date]) bookingsByDate[b.date] = [];
    bookingsByDate[b.date].push(b);
  }

  // 3️⃣ Calendar logic
  const available_days = [];
  const start = new Date(from);
  const end = new Date(to);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    const dayBookings = bookingsByDate[date] || [];

    if (slot_limit.type === 'day') {
      const remaining = slot_limit.limit - dayBookings.length;
      if (remaining > 0) {
        available_days.push({ date, remaining_slots: remaining });
      }
    }

    if (slot_limit.type === 'hour') {
      const usage = {};
      for (const b of dayBookings) {
        if (!activeTimeslotIds.has(b.timeslot_id)) continue;
        usage[b.timeslot_id] = (usage[b.timeslot_id] || 0) + 1;
      }

      let maxRemaining = 0;
      for (const tsId of activeTimeslotIds) {
        const used = usage[tsId] || 0;
        maxRemaining = Math.max(maxRemaining, slot_limit.limit - used);
      }

      if (maxRemaining > 0) {
        available_days.push({ date, remaining_slots: maxRemaining });
      }
    }
  }

  return res.status(200).json({ available_days });
}
