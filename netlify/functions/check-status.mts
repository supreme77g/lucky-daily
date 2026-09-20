// netlify/functions/check-status.mts
//
// Called from the app like:
//   GET /.netlify/functions/check-status?email=someone@example.com
//
// Returns { premium: boolean } so the front-end knows whether to unlock
// the paid features. This never talks to Paddle directly — it just reads
// the cache the webhook function keeps up to date, so it's fast.

import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

export default async (req: Request) => {
  const url = new URL(req.url);
  const email = url.searchParams.get('email')?.trim().toLowerCase();

  if (!email) {
    return Response.json({ premium: false, error: 'missing email' }, { status: 400 });
  }

  const store = getStore('subscribers');
  const record = await store.get(email, { type: 'json' });

  if (!record) {
    return Response.json({ premium: false });
  }

  return Response.json({
    premium: !!record.premium,
    status: record.status,
    currentPeriodEnd: record.currentPeriodEnd,
  });
};

export const config: Config = {
  path: '/.netlify/functions/check-status',
};
