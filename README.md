# Amana — Escrow for social commerce

**Amana** (Hausa/Arabic: trust, a thing kept safe) is an escrow layer for Instagram and Twitter/X vendors in Nigeria. Buyers pay into escrow instead of straight to a seller's account; sellers only get paid once the buyer confirms the item arrived. Built for the Nomba Challenge hackathon, using Nomba's Checkout, Transfers, and Webhooks APIs.

## How it works

1. Seller creates an order (product, price, their bank details) and gets a shareable link.
2. Buyer opens the link and pays via Nomba's hosted checkout (card or transfer).
3. Nomba sends a **webhook** to Amana's server confirming payment → order flips to "held in escrow."
4. Buyer clicks "I received my order" → Amana calls Nomba's transfer API to pay the seller.

This is a **webhook-native** design on purpose: the server never polls Nomba for payment status — it reacts to the `payment_success` event the moment Nomba sends it, which is what makes the buyer's page update live without a refresh.

## Project structure

```
amana/
  backend/          Express API + webhook handler + Nomba client
    server.js
    src/
      nombaClient.js       auth, checkout orders, bank lookup, payouts
      db.js                simple JSON-file order store (swap for Postgres later)
      routes/orders.js     order CRUD, pay, confirm-delivery
      routes/webhook.js    receives Nomba's payment_success events
      utils/verifySignature.js   HMAC signature check
  frontend/         Static seller dashboard + buyer order page (vanilla JS)
```

## Setup

1. **Get Nomba API credentials**: log into your Nomba dashboard → Settings → API Keys, and Settings → Webhooks. You'll need `accountId`, `client_id`, `client_secret`, and (once you register a webhook URL) a signature key.

2. **Install & configure the backend:**
   ```bash
   cd backend
   npm install
   cp .env.example .env
   # fill in NOMBA_ACCOUNT_ID, NOMBA_CLIENT_ID, NOMBA_CLIENT_SECRET, NOMBA_SIGNATURE_KEY
   ```

3. **Expose your server for Nomba's webhook** (Nomba needs a public URL to POST to). During dev, use ngrok:
   ```bash
   ngrok http 4000
   ```
   Then in the Nomba dashboard, register `https://<your-ngrok-domain>/api/webhook/nomba` as your webhook URL, subscribed to the **Payment success** event, with the signature key you set in `.env`.

4. **Run it:**
   ```bash
   npm start
   ```
   Visit `http://localhost:4000` — the Express server serves both the API and the frontend.

## Deploying (Render)

Render's free web service tier has an ephemeral filesystem — anything written to disk (like the local JSON order store) is wiped on every restart or redeploy. To keep demo data around:

1. In Render, create a **free Postgres instance** (Dashboard → New + → PostgreSQL). Copy its "Internal Database URL."
2. On your Web Service, add an environment variable `DATABASE_URL` set to that connection string.
3. That's it — the backend detects `DATABASE_URL` automatically and switches from the JSON file store to Postgres, creating its `orders` table on first boot. No code changes needed.
4. Also set `PUBLIC_BASE_URL` and `FRONTEND_BASE_URL` to your Render URL (e.g. `https://amana-escrow.onrender.com`), and register `<that-url>/api/webhook/nomba` in the Nomba dashboard as your webhook endpoint.

Check `GET /api/health` after deploying — it reports which store is active and whether it's actually reachable, e.g.:
```json
{ "ok": true, "service": "amana-escrow", "store": "postgres", "storeConnected": true }
```
If `store` says `"file"` on Render, `DATABASE_URL` isn't set correctly — your data won't survive the next redeploy.

Without `DATABASE_URL` set, everything still runs fine locally against the JSON file in `backend/data/orders.json`.

## Demo flow (for judges, without needing a live bank transfer)

Every order page has a **"Simulate payment confirmation"** link. It flips the order straight to `held_in_escrow` without waiting for a real webhook — useful if your demo environment can't expose a public webhook URL live on stage. The rest of the flow (confirm delivery → payout call) still goes through the real Nomba transfer API, so the escrow-release step is genuinely demonstrated end to end.

For the full real flow: create an order → open the share link → pay with a Nomba test card/transfer → watch the page flip to "held in escrow" the moment the webhook lands (poll interval is 4s) → confirm delivery → seller gets paid.

## Notes on the Nomba integration

Verified directly against Nomba's published API reference:

- **Auth** (`POST /v1/auth/token/issue`) — response shape is `{ data: { access_token, refresh_token, expiresAt } }`, where `expiresAt` is an ISO timestamp (not a seconds-based expiry). The client parses this correctly and caches the token until ~30s before it expires.
- **Checkout order creation** (`POST /v1/checkout/order`) — the `order` object shape (`orderReference`, `callbackUrl`, `customerEmail`, `amount`, `currency`, `accountId`, `allowedPaymentMethods`, `orderMetaData`) matches Nomba's sample requests exactly.
- **Bank transfer payout** (`POST /v2/transfers/bank`) — Nomba requires `accountName` in addition to `accountNumber` and `bankCode`, which the original build missed. `confirm-delivery` now calls the bank lookup endpoint first to resolve the seller's `accountName` before releasing funds. Requests also include an `X-Idempotent-key` header (Nomba's documented recommendation for transfer calls), so a retried request after a dropped connection can't double-pay a seller.
- **Webhook signature verification** — confirmed against Nomba's official docs (`developer.nomba.com/docs/api-basics/webhook`). Headers are `nomba-signature` and `nomba-timestamp` (not the generic names originally guessed), and the signature is **base64-encoded** HMAC-SHA256 (not hex, which the original build used). Both are now fixed in `verifySignature.js`. The formula itself — colon-joined `event_type:requestId:merchant.userId:merchant.walletId:transaction.transactionId:transaction.type:transaction.time:transaction.responseCode:timestamp` — was correct from the start. The webhook route now **fails closed**: if `NOMBA_SIGNATURE_KEY` is set and a signature doesn't verify, the request is rejected with 401 rather than processed anyway.

One real gap, worth understanding before you demo:

- **Matching a webhook back to an order.** Nomba's own documented sample payload for `payment_success` is for a virtual-account transfer (`transaction.type: "vact_transfer"`) and has no explicit `orderReference` field — it carries `aliasAccountReference`/`aliasAccountNumber` instead. Amana's checkout flow may surface the reference under a different field for card/PayByTransfer payments, but that exact shape wasn't visible in what the docs returned. `extractOrderReference` in `routes/webhook.js` checks the most likely field names, and as a safety net, `matchByAmountFallback` will match the most recent `awaiting_payment` order with the same amount if no explicit reference is found — a heuristic, not a guarantee, that keeps a real payment from silently vanishing mid-demo. **Log one real webhook payload from a checkout order payment** (the code already logs the full body) and confirm which field actually carries your reference, then tighten `extractOrderReference` accordingly.
- Nomba retries failed webhook deliveries (non-2xx response) up to 5 times with exponential backoff over roughly an hour — so a brief server hiccup during judging won't lose the event, it'll just arrive a couple minutes late.

## Testing without real money

Nomba's sandbox (`https://sandbox.nomba.com`) accepts requests with **no auth headers at all** — no bearer token, no `accountId`. Set `NOMBA_BASE_URL=https://sandbox.nomba.com` in your `.env` to hit it directly while you build, which is much faster than wiring up full OAuth first. Switch back to `https://api.nomba.com` (or just unset the variable) for the real demo.

## Pitching it

The core insight: Nigerian social commerce runs on DMs and vibes, not carts and checkouts. Amana doesn't ask vendors to change platforms — it just gives them a trust layer that slots into a WhatsApp/IG DM as a single link, backed by real payment infrastructure instead of "just trust me."
