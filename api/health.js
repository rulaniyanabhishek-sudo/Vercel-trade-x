import { getCachedSnapshot, getProviderInfo, isIndianMarketSession } from '../server/live-data-service.mjs';
import { setCors, handleOptions } from './_cors.js';

export default function handler(req, res) {
  if (handleOptions(req, res)) return;
  setCors(res);
  res.status(200).json({
    ok: true,
    platform: 'vercel',
    marketSessionOpen: isIndianMarketSession(),
    cached: !!getCachedSnapshot(),
    provider: getProviderInfo(),
    time: new Date().toISOString()
  });
}
