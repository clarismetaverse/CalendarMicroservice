export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    offer_id: offerId,
    from,
    to,
    bookings = [],
    offer_timeslots = [],
    timeslots = [],
  } = req.body || {};

  if (!offerId || !from || !to) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Timeslot lookup
  const timeslotById = new Map(
    timeslots.map(slot => [slot.id, slot])
  );

  // Active timeslots for this offer
  const activeTimeslotIds = new Set(
    offer_timeslots
      .filter(o => o.offer_upgrade_id === offerId && o.active)
      .map(o => o.timeslot_id)
  );

  const slotLimit =
    bookings.find(b => b.offer_upgrade_id === offerId)?.SlotLimit || null;

  if (!slotLimit || !slotLimit.Type || typeof slotLimit.Limit !== 'number') {
    return res.status(200).json({ available_days: [] });
  }

  // Filter confirmed bookings in date range
  const filteredBookings = bookings.filter(b =>
    b.offer_upgrade_id === offerId &&
    b.status === 'confirmed' &&
    b.date >= from &&
    b.date <= to
  );

  // Group bookings by date
  const bookingsByDate = new Map();
  for (const b of filteredBookings) {
    if (!bookingsByDate.has(b.date)) {
      bookingsByDate.set(b.date, []);
    }
    bookingsByDate.get(b.date).push(b);
  }

  const availableDays = [];

  const startDate = new Date(`${from}T00:00:00Z`);
  const endDate = new Date(`${to}T00:00:00Z`);

  for (
    let d = new Date(startDate);
    d <= endDate;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const date = d.toISOString().slice(0, 10);
    const dayBookings = bookingsByDate.get(date) || [];

    // DAY LIMIT
    if (slotLimit.Type === 'day') {
      const remaining = slotLimit.Limit - dayBookings.length;
      if (remaining > 0) {
        availableDays.push({
          date,
          available: true,
          remaining_slots: remaining
        });
      }
      continue;
    }

    // HOUR / TIMESLOT LIMIT
    if (slotLimit.Type === 'hour') {
      const usage = new Map();

      for (const b of dayBookings) {
        if (!activeTimeslotIds.has(b.timeslot_id)) continue;
        usage.set(
          b.timeslot_id,
          (usage.get(b.timeslot_id) || 0) + 1
        );
      }

      let hasAvailability = false;
      let maxRemaining = 0;

      for (const tsId of activeTimeslotIds) {
        if (!timeslotById.has(tsId)) continue;
        const used = usage.get(tsId) || 0;
        const remaining = slotLimit.Limit - used;
        if (remaining > 0) {
          hasAvailability = true;
          maxRemaining = Math.max(maxRemaining, remaining);
        }
      }

      if (hasAvailability) {
        availableDays.push({
          date,
          available: true,
          remaining_slots: maxRemaining
        });
      }
    }
  }

  return res.status(200).json({
    available_days: availableDays
  });
}
  }

  return res.status(200).json({ available_days: availableDays });
}
