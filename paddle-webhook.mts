// netlify/functions/paddle-webhook.mts
//
// Paddle calls this URL every time a subscription is created, renewed,
// paused, canceled, or fails to bill. We verify the request really came
// from Paddle, then write a small "is this email premium" record to
// Netlify Blobs so the app can check it instantly without calling Paddle
// on every page load.
//
// Set this as your webhook URL in Paddle:
//   https://deacondigits.com/.netlify/functions/paddle-webhook

import type { Config } from '@netlify/functions';
import { Paddle, Environment, EventName } from '@paddle/paddle-node-sdk';
import { getStore } from '@netlify/blobs';

const paddle = new Paddle(process.env.PADDLE_API_KEY!, {
  environment: process.env.PADDLE_ENV === 'production' ? Environment.production : Environment.sandbox,
});

// Statuses that mean "let them in"
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);
// past_due is included on purpose: Paddle is still retrying the card, and
// kicking someone off a $1.99/mo app the moment a card hiccups is a bad
// experience. If you'd rather be strict, remove 'past_due' from this set.

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const signature = req.headers.get('paddle-signature') || '';
  const rawBody = await req.text();

  let event;
  try {
    event = await paddle.webhooks.unmarshal(rawBody, process.env.PADDLE_WEBHOOK_SECRET!, signature);
  } catch (err) {
    console.error('Paddle signature verification failed', err);
    return new Response('Invalid signature', { status: 403 });
  }

  const store = getStore('subscribers');

  switch (event.eventType) {
    case EventName.SubscriptionCreated:
    case EventName.SubscriptionUpdated:
    case EventName.SubscriptionCanceled:
    case EventName.SubscriptionPastDue:
    case EventName.SubscriptionPaused:
    case EventName.SubscriptionResumed: {
      const sub = event.data;
      const email = (sub.customer as any)?.email || (await fetchCustomerEmail(sub.customerId));
      if (!email) {
        console.warn('No email on subscription event, skipping', sub.id);
        break;
      }

      const key = email.trim().toLowerCase();
      const record = {
        email: key,
        customerId: sub.customerId,
        subscriptionId: sub.id,
        status: sub.status, // 'active' | 'trialing' | 'past_due' | 'paused' | 'canceled'
        premium: ACTIVE_STATUSES.has(sub.status),
        currentPeriodEnd: sub.currentBillingPeriod?.endsAt ?? null,
        updatedAt: new Date().toISOString(),
      };

      await store.setJSON(key, record);
      console.log(`Subscriber ${key} -> ${record.status} (premium: ${record.premium})`);
      break;
    }
    default:
      // Other events (transaction.*, customer.*, etc.) — ignore for now.
      break;
  }

  // Acknowledge quickly. Paddle retries anything that isn't a 2xx.
  return new Response('ok', { status: 200 });
};

// Fallback: subscription events sometimes only include customerId, not the
// email inline. Look it up via the Paddle API if we need to.
async function fetchCustomerEmail(customerId: string | undefined): Promise<string | null> {
  if (!customerId) return null;
  try {
    const customer = await paddle.customers.get(customerId);
    return customer.email ?? null;
  } catch (err) {
    console.error('Could not fetch customer email', customerId, err);
    return null;
  }
}

export const config: Config = {
  path: '/.netlify/functions/paddle-webhook',
};
