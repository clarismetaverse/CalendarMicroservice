export default function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const {
      book = [],
      offer_timeslot = [],
      from,
      to
    } = req.body || {};

    if (!from || !to || !Array.isArray(offer_timeslot)) {
      return res.status(400).json({ error: 'Invalid input payload' });
    }

    // Build active timeslots
    const activeSlots = offer_timeslot
      .filter(o => o.active && o._timeslot?.length)
      .map(o => ({
        id: o.timeslot_id,
        start: o._timeslot[0].Start_time,
        end: o._timeslot[0].End_time,
        capacity: o.capacity_override > 0 ? o.capacity_override : null
      }));

    if (!activeSlots.length) {
      return res.status(200).json({ available_days: [] });
    }

    // Group bookings by date + timeslot
    const bookingsByDay = {};

    for (const b of book) {
      if (b.status !== 'CONFIRMED') continue;

      const day = new Date(b.timestamp).toISOString().slice(0, 10);

      if (!bookingsByDay[day]) {
        bookingsByDay[day] = {};
      }

      bookingsByDay[day][b.timeslot_id] =
        (bookingsByDay[day][b.timeslot_id] || 0) + 1;
    }

    const availableDays = [];

    for (
      let cursor = from;
      cursor <= to;
      cursor += 86400000
    ) {
      const day = new Date(cursor).toISOString().slice(0, 10);
      const dayBookings = bookingsByDay[day] || {};

      let remaining = 0;

      for (const slot of activeSlots) {
        const used = dayBookings[slot.id] || 0;
        const cap = slot.capacity ?? 1;

        if (cap - used > 0) {
          remaining += cap - used;
        }
      }

      if (remaining > 0) {
        availableDays.push({
          date: day,
          remaining_slots: remaining
        });
      }
    }

    return res.status(200).json({ available_days: availableDays });

  } catch (err) {
    console.error('Calendar microservice error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
