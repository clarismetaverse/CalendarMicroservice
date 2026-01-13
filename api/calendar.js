export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  return res.status(200).json({
    ok: true,
    message: 'Calendar microservice is live'
  })
}
  const {
    offer_id: offerId,
    from,
    to,
    bookings = [],
    offer_timeslots: offerTimeslots = [],
    timeslots = [],
  } = req.body || {};

  if (!offerId || !from || !to) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  // Build quick lookup for timeslots by id.
  const timeslotById = new Map(timeslots.map((slot) => [slot.id, slot]));

  // Determine active timeslots for the offer.
  const activeTimeslotIds = new Set(
    offerTimeslots
      .filter((entry) => entry.offer_upgrade_id === offerId && entry.active)
      .map((entry) => entry.timeslot_id)
  );

  const slotLimit =
    bookings.find((booking) => booking.offer_upgrade_id === offerId)?.SlotLimit ||
    null;

  // Filter bookings by offer, status, and date range.
  const filteredBookings = bookings.filter((booking) => {
    if (booking.offer_upgrade_id !== offerId) return false;
    if (booking.status !== 'confirmed') return false;
    if (booking.date < from || booking.date > to) return false;
    return true;
  });

  // Group bookings by date.
  const bookingsByDate = new Map();
  for (const booking of filteredBookings) {
    if (!bookingsByDate.has(booking.date)) {
      bookingsByDate.set(booking.date, []);
    }
    bookingsByDate.get(booking.date).push(booking);
  }

  const availableDays = [];

  const hasValidSlotLimit =
    slotLimit && slotLimit.Type && typeof slotLimit.Limit === 'number';

  if (!hasValidSlotLimit || activeTimeslotIds.size === 0) {
    return res.status(200).json({ available_days: [] });
  }

  const startDate = new Date(`${from}T00:00:00Z`);
  const endDate = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return res.status(400).json({ error: 'Invalid date range.' });
  }

  for (
    let cursor = new Date(startDate);
    cursor <= endDate;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const date = cursor.toISOString().slice(0, 10);
    const dateBookings = bookingsByDate.get(date) || [];

    if (slotLimit.Type === 'day') {
      // Day limit applies to total confirmed bookings.
      const remaining = slotLimit.Limit - dateBookings.length;
      if (remaining > 0) {
        availableDays.push({
          date,
          available: true,
          remaining_slots: remaining,
        });
      }
      continue;
    }

    if (slotLimit.Type === 'hour') {
      // Hour limit applies per timeslot.
      const bookingsByTimeslot = new Map();
      for (const booking of dateBookings) {
        if (!activeTimeslotIds.has(booking.timeslot_id)) {
          continue;
        }
        bookingsByTimeslot.set(
          booking.timeslot_id,
          (bookingsByTimeslot.get(booking.timeslot_id) || 0) + 1
        );
      }

      let maxRemaining = 0;
      for (const timeslotId of activeTimeslotIds) {
        if (!timeslotById.has(timeslotId)) {
          continue;
        }
        const used = bookingsByTimeslot.get(timeslotId) || 0;
        const remaining = slotLimit.Limit - used;
        if (remaining > maxRemaining) {
          maxRemaining = remaining;
        }
      }

      if (maxRemaining > 0) {
        availableDays.push({
          date,
          available: true,
          remaining_slots: maxRemaining,
        });
      }
    }
  }

  return res.status(200).json({ available_days: availableDays });
}
