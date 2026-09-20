# Lucky Daily — payment backend

What's in here:

```
netlify/functions/paddle-webhook.mts   -> Paddle tells us when someone subscribes/cancels
netlify/functions/check-status.mts     -> the app asks "is this email premium?"
site-snippet/paddle-checkout.js        -> front-end: opens checkout, gates features
netlify.toml                           -> tells Netlify where the functions live
.env.example                           -> the 4 secrets you need to set
```

No database — subscriber status lives in **Netlify Blobs**, which comes
free with your Netlify account.

## How it flows

1. User clicks "Go Premium" → `Paddle.Checkout.open()` (client-side, in
   `paddle-checkout.js`)
2. They pay → Paddle sends a webhook to `paddle-webhook.mts`
3. That function verifies it's really from Paddle, then writes
   `{ email, premium: true }` to Netlify Blobs
4. The app calls `check-status.mts` with the user's email to decide
   whether to unlock premium features

## Setup, in order

### 1. Repo + Netlify
- Push this alongside your `index.html` to the GitHub repo
- In Netlify: **Add new site → Import from Git** → pick the repo
- Netlify will read `netlify.toml` and deploy the functions automatically

### 2. Cloudflare DNS
- In Netlify, go to **Domain settings → Add a domain** → `deacondigits.com`
- Netlify shows you a DNS target (usually a CNAME or an "apex domain"
  A record)
- In Cloudflare, add that record for `deacondigits.com` — set it to
  **DNS only** (grey cloud), not proxied, at least at first, so Netlify's
  own SSL cert can issue cleanly

### 3. Paddle — sandbox first
- Paddle dashboard → make sure you're in **Sandbox** mode (toggle top left)
- **Catalog → Products** → create "Lucky Daily Premium"
- Add a price: **$1.99, Recurring, Monthly** → copy the price ID (`pri_...`)
- **Developer Tools → Authentication** → copy your **API key** (server
  secret) and your **client-side token** (for the checkout widget)
- **Developer Tools → Notifications → New destination**
  - URL: `https://deacondigits.com/.netlify/functions/paddle-webhook`
  - Events to send: at minimum `subscription.created`,
    `subscription.updated`, `subscription.canceled`
  - Copy the **secret key** it gives you

### 4. Environment variables (Netlify → Site settings → Environment variables)
```
PADDLE_API_KEY=<server API key from step 3>
PADDLE_WEBHOOK_SECRET=<secret key from the notification destination>
PADDLE_ENV=sandbox
PADDLE_PRICE_ID=<pri_... from step 3>
```

### 5. Wire up the front-end
In `site-snippet/paddle-checkout.js`, fill in `PADDLE_CLIENT_TOKEN` and
`PADDLE_PRICE_ID`, then in your `index.html`:

```html
<script src="https://cdn.paddle.com/paddle/v2/paddle.js"></script>
<script src="/paddle-checkout.js"></script>
```

Wire your existing "Go Premium" button to:
```js
LuckyDailyBilling.openCheckout();
```

And wherever a feature is gated:
```js
if (await LuckyDailyBilling.isPremium()) {
  // unlock it
}
```

> Heads up: this script has to live in the copy of the site that's
> actually deployed on Netlify. It won't run inside the Claude artifact
> preview — that preview's sandbox blocks Paddle's script on purpose.

### 6. Test it end-to-end (still in sandbox)
- Use one of [Paddle's test card numbers](https://developer.paddle.com/concepts/payment-methods/credit-debit-card#test-cards)
- Complete a checkout, then check **Netlify → Functions → paddle-webhook**
  logs to confirm it fired and wrote to Blobs
- Refresh the app and confirm the premium feature unlocks

### 7. Go live
- Flip Paddle to **Live** mode, redo steps 3–4 with the live keys (Paddle
  keeps sandbox and live completely separate)
- Update `PADDLE_ENV=production` in Netlify and in `paddle-checkout.js`
- Switch the Cloudflare DNS record to proxied (orange cloud) once
  everything's confirmed working, if you want Cloudflare's CDN/caching too

## A note on `past_due`
The webhook treats `past_due` subscriptions as still-premium, on purpose —
Paddle is still retrying a failed card in the background, and cutting
someone off from a $1.99/mo app the moment their card hiccups is a rough
first impression. If you'd rather be strict about it, it's one line to
change in `paddle-webhook.mts` (see the `ACTIVE_STATUSES` set).
