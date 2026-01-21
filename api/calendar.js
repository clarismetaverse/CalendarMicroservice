import type { VercelRequest, VercelResponse } from 'vercel'

const XANO_RAW_URL =
  'https://xbut-eryu-hhsg.f2.xano.io/api:vGd6XDW3/calendar/raw/Data'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const offerId = Number(req.query.offer_id)
  const from = Number(req.query.from)
  const to = Number(req.query.to)

  if (!offerId || !from || !to) {
    return res.status(400).json({
      error: 'Missing required params: offer_id, from, to'
    })
  }

  // 1️⃣ Fetch raw data from Xano
  const rawRes = await fetch(XANO_RAW_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      offer_id: offerId,
      from,
      to
    })
  })

  if (!rawRes.ok) {
    return res.status(500).json({
      error: 'Failed to fetch raw calendar data'
    })
  }

  const raw = await rawRes.json()

  const bookings = raw.book ?? []
  const offerTimeslots = raw.offer_timeslot ?? []

  // 2️⃣ Active timeslots for this offer
  const activeTimeslotIds = new Set(
    offerTimeslots
      .filter((o: any) => o.active)
      .map((o: any) => o.timeslot_id)
  )

  if (activeTimeslotIds.size === 0) {
    return res.status(200).json({ available_days: [] })
  }

  // 3️⃣ Slot limit logic (day or hour)
  const slotLimit =
    bookings.find((b: any) => b.offer_upgrade_id === offerId)?.SlotLimit ?? null

  if (!slotLimit || !slotLimit.Type || !slotLimit.Limit) {
    return res.status(200).json({ available_days: [] })
  }

  // 4️⃣ Group confirmed bookings by date
  const confirmed = bookings.filter(
    (b: any) =>
      b.offer_upgrade_id === offerId &&
      b.status === 'CONFIRMED' &&
      b.timestamp >= from &&
      b.timestamp <= to
  )

  const bookingsByDay = new Map<string, any[]>()
  for (const b of confirmed) {
    if (!bookingsByDay.has(b.date)) {
      bookingsByDay.set(b.date, [])
    }
    bookingsByDay.get(b.date)!.push(b)
  }

  // 5️⃣ Iterate calendar days
  const availableDays: any[] = []

  for (
    let cursor = new Date(from);
    cursor.getTime() <= to;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const dateISO = cursor.toISOString().slice(0, 10)
    const dayBookings = bookingsByDay.get(dateISO) ?? []

    // 🟢 DAY BASED LIMIT
    if (slotLimit.Type === 'day') {
      const remaining = slotLimit.Limit - dayBookings.length
      if (remaining > 0) {
        availableDays.push({
          date: dateISO,
          timestamp: cursor.getTime(),
          remaining_slots: remaining
        })
      }
      continue
    }

    // 🟣 TIMESLOT BASED LIMIT
    if (slotLimit.Type === 'hour') {
      const usedBySlot = new Map<number, number>()

      for (const b of dayBookings) {
        if (!activeTimeslotIds.has(b.timeslot_id)) continue
        usedBySlot.set(
          b.timeslot_id,
          (usedBySlot.get(b.timeslot_id) ?? 0) + 1
        )
      }

      let hasFreeSlot = false

      for (const slotId of activeTimeslotIds) {
        const used = usedBySlot.get(slotId) ?? 0
        if (slotLimit.Limit - used > 0) {
          hasFreeSlot = true
          break
        }
      }

      if (hasFreeSlot) {
        availableDays.push({
          date: dateISO,
          timestamp: cursor.getTime(),
          remaining_slots: 1
        })
      }
    }
  }

  // 6️⃣ Response
  return res.status(200).json({
    ok: true,
    offer_id: offerId,
    range: { from, to },
    available_days: availableDays
  })
}
