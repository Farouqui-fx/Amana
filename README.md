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

## Demo flow (for judges, without needing a live bank transfer)

Every order page has a **"Simulate payment confirmation"** link. It flips the order straight to `held_in_escrow` without waiting for a real webhook — useful if your demo environment can't expose a public webhook URL live on stage. The rest of the flow (confirm delivery → payout call) still goes through the real Nomba transfer API, so the escrow-release step is genuinely demonstrated end to end.

For the full real flow: create an order → open the share link → pay with a Nomba test card/transfer → watch the page flip to "held in escrow" the moment the webhook lands (poll interval is 4s) → confirm delivery → seller gets paid.

## Notes on the Nomba integration

A few implementation details were built against Nomba's public docs but are worth double-checking against your live dashboard/sandbox before a real demo, since some fields weren't fully documented in what I could pull:

- **`initiateBankTransfer`** (`src/nombaClient.js`) posts to `POST /v2/transfers/bank` with `amount`, `accountNumber`, `bankCode`, `merchantTxRef`, `narration`. Confirm exact field names against the API reference — the transfer endpoint's full request schema wasn't fully visible when this was built.
- **Webhook signature verification** (`src/utils/verifySignature.js`) implements Nomba's documented HMAC-SHA256 scheme (colon-joined payload fields + timestamp), but the exact header names Nomba sends the signature and timestamp in weren't confirmed. It currently reads `signature` and `timestamp` headers — log `req.headers` from a real webhook hit and adjust `SIGNATURE_HEADER`/`TIMESTAMP_HEADER` if they differ. Verification currently fails open (logs a warning, still processes) so a header mismatch doesn't block your demo — tighten this to fail closed before handling real money.
- **Matching a webhook back to an order** (`extractOrderReference` in `src/routes/webhook.js`) checks a few likely payload locations for the order reference. Log one real `payment_success` payload for a checkout order and confirm which field it actually lands in.

## Pitching it

The core insight: Nigerian social commerce runs on DMs and vibes, not carts and checkouts. Amana doesn't ask vendors to change platforms — it just gives them a trust layer that slots into a WhatsApp/IG DM as a single link, backed by real payment infrastructure instead of "just trust me."
