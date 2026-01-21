export default function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const {
      offer_id,
      from,
      to,
      book = [],
      offer_timeslot = []
    } = req.body || {};

    if (!offer_id || !from || !to) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Build active timeslots map
    const activeTimeslots = new Map();
    for (const ots of offer_timeslot) {
      if (!ots.active) continue;
      if (!ots._timeslot || !ots._timeslot[0]) continue;

      activeTimeslots.set(ots.timeslot_id, {
        id: ots.timeslot_id,
        start: ots._timeslot[0].Start_time,
        end: ots._timeslot[0].End_time,
        capacity: ots.capacity_override || null
      });
    }

    if (activeTimeslots.size === 0) {
      return res.status(200).json({ available_days: [] });
    }

    // Normalize bookings
    const bookings = book.filter(b =>
      b.offer_upgrade_id === offer_id &&
      b.status === 'CONFIRMED' &&
      b.timestamp >= from &&
      b.timestamp <= to &&
      b.timeslot_id !== 0
    );

    // Group bookings by day
    const bookingsByDay = new Map();
    for (const b of bookings) {
      const day = new Date(b.timestamp).toISOString().slice(0, 10);
      if (!bookingsByDay.has(day)) bookingsByDay.set(day, []);
      bookingsByDay.get(day).push(b);
    }

    const available_days = [];
    const start = new Date(from);
    const end = new Date(to);

    for (
      let d = new Date(start);
      d <= end;
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      const day = d.toISOString().slice(0, 10);
      const dayBookings = bookingsByDay.get(day) || [];

      let maxRemaining = 0;

      for (const [timeslotId] of activeTimeslots) {
        const used = dayBookings.filter(b => b.timeslot_id === timeslotId).length;
        const remaining = 1 - used; // default capacity = 1
        if (remaining > maxRemaining) maxRemaining = remaining;
      }

      if (maxRemaining > 0) {
        available_days.push({
          date: day,
          available: true,
          remaining_slots: maxRemaining
        });
      }
    }

    return res.status(200).json({ available_days });

  } catch (err) {
    console.error('Calendar microservice error:', err);
    return res.status(500).json({
      error: 'Internal Server Error',
      detail: err.message
    });
  }
}
