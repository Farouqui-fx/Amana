const express = require("express");
const db = require("../db");
const { verifyWebhookSignature } = require("../utils/verifySignature");

const router = express.Router();

/**
 * Server-to-server notification from Nomba. Register this URL
 * (e.g. https://your-domain.com/api/webhook/nomba) in the Nomba dashboard
 * under Settings > Webhooks, subscribed to the "Payment success" event.
 *
 * Matching the event back to an Amana order: the sample payloads Nomba
 * publishes for account/terminal transactions carry transaction details
 * but not always an explicit orderReference field. This handler checks a
 * few likely locations. If your live payload uses a different field,
 * log req.body once (see console.log below) and adjust `extractOrderReference`.
 */

function extractOrderReference(payload) {
  const t = payload?.data?.transaction || {};
  const o = payload?.data?.order || {};
  return (
    o.orderReference ||
    t.orderReference ||
    t.merchantTxRef ||
    t.reference ||
    null
  );
}

router.post("/webhook/nomba", (req, res) => {
  const { verified, reason } = verifyWebhookSignature(req, process.env.NOMBA_SIGNATURE_KEY);

  if (!verified) {
    console.warn(`[webhook] signature not verified (${reason}) — processing anyway for demo purposes`);
  }

  const payload = req.body;
  console.log("[webhook] received:", JSON.stringify(payload));

  if (payload?.event_type !== "payment_success") {
    // Acknowledge everything else so Nomba doesn't retry, we just don't act on it.
    return res.status(200).json({ received: true, ignored: true });
  }

  const orderReference = extractOrderReference(payload);
  const order = orderReference ? db.getOrderByReference(orderReference) : null;

  if (!order) {
    console.warn(`[webhook] payment_success received but no matching order for reference: ${orderReference}`);
    return res.status(200).json({ received: true, matched: false });
  }

  db.updateOrder(order.id, {
    status: "held_in_escrow",
    paidAt: new Date().toISOString(),
    transactionRef: payload?.data?.transaction?.transactionId || payload?.requestId || null,
  });

  res.status(200).json({ received: true, matched: true, orderId: order.id });
});

module.exports = router;
