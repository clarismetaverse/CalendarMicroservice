# Xano API: Booking Availability by Day + Timeslot

This document describes a Xano API endpoint that calculates booking availability for an offer within a date range and returns only the days and timeslots that still have availability.

## Endpoint

**Method:** `POST` (or `GET`, if preferred)

**Path:** `/availability`

### Input

```json
{
  "offer_id": 123,
  "date_from": "2024-01-01",
  "date_to": "2024-01-07"
}
```

## Tables (Assumed)

- `timeslot`
  - `id`
  - `start_time` (int, minutes 0–1440)
  - `end_time` (int, minutes 0–1440)
  - `active` (boolean)
- `weekdaysturbo`
  - `id` (1 = Monday ... 7 = Sunday)
- `Offer`
  - `id`
  - `timeslot_id` (array of timeslot IDs)
- `BookingsUpgrade`
  - `booking_id` (offer id)
  - `weekdaysturbo_id`
  - `timeframesupgrade_id` (timeslot id)
  - `SlotLimit` (object)
    - `type` = `"day" | "hour"`
    - `number` (integer)

## Output

```json
[
  {
    "date": "2024-01-01",
    "weekday_id": 1,
    "timeslots": [
      {
        "timeslot_id": 10,
        "start_time": 540,
        "end_time": 600,
        "remaining_slots": 2
      }
    ]
  }
]
```

---

## Xano Function Stack (Pseudo-Implementation)

### 1) Input & Validation

- Validate `offer_id`, `date_from`, `date_to`.
- Ensure `date_from <= date_to`.

### 2) Generate Date Range

Use a **Function Stack** step to generate a list of date objects:

```
start_date = date_from
end_date = date_to

range = []
while start_date <= end_date:
  weekday_id = WEEKDAY(start_date)  // 1-7 (Mon-Sun)
  range.push({
    date: FORMAT_DATE(start_date, "YYYY-MM-DD"),
    weekday_id: weekday_id
  })
  start_date = DATE_ADD(start_date, 1, "day")
```

> In Xano, `WEEKDAY()` returns 0–6 depending on settings. If necessary, normalize to 1–7 for `weekdaysturbo_id`.

### 3) Load Offer + Allowed Timeslots

- Query `Offer` by `offer_id`.
- Extract `timeslot_id` array.
- Fetch `timeslot` rows by IDs and `active = true`.

```
offer = GET Offer WHERE id = offer_id
allowed_timeslot_ids = offer.timeslot_id
allowed_timeslots = GET timeslot WHERE id IN allowed_timeslot_ids AND active = true
```

### 4) For Each Date, Load Booking Limits

For each item in `range`:

```
bookings_for_weekday = GET BookingsUpgrade
  WHERE booking_id = offer_id
    AND weekdaysturbo_id = weekday_id
```

> `BookingsUpgrade` rows provide the `SlotLimit` rule for each weekday/timeslot.

### 5) Count Bookings Per Date and Per Timeslot

For each allowed timeslot, compute counts:

- **Total bookings for the day**
- **Bookings for that specific timeslot**

These counts should come from your actual `booking` table (if separate). If `BookingsUpgrade` is the booking record itself, then use it directly. The logic below assumes a real booking table called `Booking` with date + timeslot fields; replace with your actual table as needed.

```
count_day = COUNT Booking
  WHERE booking_id = offer_id
    AND date = current_date

count_slot = COUNT Booking
  WHERE booking_id = offer_id
    AND date = current_date
    AND timeframesupgrade_id = timeslot.id
```

### 6) SlotLimit Logic

```
if slot_limit.type == "day":
  remaining = slot_limit.number - count_day
  available = remaining > 0

if slot_limit.type == "hour":
  remaining = slot_limit.number - count_slot
  available = remaining > 0
```

> **Important:** Each booking consumes exactly one slot. `"hour"` means a per-timeslot cap only (not per-hour repetition).

### 7) Filter Availability

For each day:

- Include only timeslots where `available = true`.
- If no timeslots remain, drop the day entirely.

### 8) Build Response

Return the list of days + timeslots:

```
response = []
for date in range:
  timeslots = []
  for timeslot in allowed_timeslots:
    slot_limit = find BookingsUpgrade row where timeframesupgrade_id == timeslot.id
    if slot_limit exists:
      compute remaining & availability
      if available:
        timeslots.push({
          timeslot_id: timeslot.id,
          start_time: timeslot.start_time,
          end_time: timeslot.end_time,
          remaining_slots: remaining
        })
  if timeslots.length > 0:
    response.push({
      date: date.date,
      weekday_id: date.weekday_id,
      timeslots: timeslots
    })

return response
```

---

## Notes / Edge Cases

- If a weekday has **no `BookingsUpgrade` entries**, that weekday/timeslot should be treated as **not available** (no slot limit defined).
- If a `SlotLimit.number <= 0`, the slot should be considered unavailable.
- If `allowed_timeslot_ids` is empty, return an empty array.
- If `date_from` > `date_to`, return a validation error.

## Example Response (Filtered)

```json
[
  {
    "date": "2024-01-02",
    "weekday_id": 2,
    "timeslots": [
      {
        "timeslot_id": 7,
        "start_time": 600,
        "end_time": 660,
        "remaining_slots": 1
      }
    ]
  }
]
```
