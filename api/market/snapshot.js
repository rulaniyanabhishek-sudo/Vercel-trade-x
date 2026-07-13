import { getMarketSnapshot } from '../../server/live-data-service.mjs';
import { setCors, handleOptions } from '../_cors.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  setCors(res);
  try {
    const force = String(req.query?.force || '') === '1';
    const snapshot = await getMarketSnapshot({ force });
    res.status(200).json(snapshot);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
}
