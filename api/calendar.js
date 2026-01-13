export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // ✅ GET → query params
    const {
      offer_id: offerId,
      from,
      to,
    } = req.query;

    if (!offerId || !from || !to) {
      return res.status(400).json({
        error: 'Missing required query params: offer_id, from, to',
      });
    }

    // 🔹 Placeholder response (così verifichiamo che FUNZIONA)
    return res.status(200).json({
      ok: true,
      offer_id: Number(offerId),
      range: { from, to },
      message: 'Calendar microservice is live and reachable',
    });

  } catch (err) {
    console.error('Calendar API error:', err);
    return res.status(500).json({
      error: 'Internal server error',
    });
  }
}
