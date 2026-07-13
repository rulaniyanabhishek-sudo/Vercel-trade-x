import { getNiftyOptionTableSnapshot } from '../../server/live-data-service.mjs';
import { setCors, handleOptions } from '../_cors.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  setCors(res);
  try {
    const force = String(req.query?.force || '') === '1';
    const snapshot = await getNiftyOptionTableSnapshot({ force });
    if (!snapshot) res.status(503).json({ ok: false, error: 'No option-chain snapshot available. Configure UPSTOX_ACCESS_TOKEN or use fallback build data.' });
    else res.status(200).json(snapshot);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
}
