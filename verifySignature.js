/**
 * Verifies Nomba webhook signatures.
 *
 * Per Nomba's docs, the signature is an HMAC-SHA256 built from a colon-joined
 * string of specific payload fields plus a timestamp, using your webhook
 * Signature Key as the secret:
 *
 *   hashingPayload = event_type:requestId:merchant.userId:merchant.walletId:
 *                    transaction.transactionId:transaction.type:
 *                    transaction.time:transaction.responseCode
 *   message = hashingPayload:timestamp
 *   signature = HMAC_SHA256(message, signatureKey)  (hex)
 *
 * The exact header names Nomba sends the signature/timestamp in weren't
 * fully confirmed at build time — check the request headers Nomba actually
 * sends to your endpoint (log req.headers once) and adjust SIGNATURE_HEADER /
 * TIMESTAMP_HEADER below if needed. Until confirmed, verification fails
 * open to "unverified" rather than silently trusting the payload — the
 * route logs a warning but still processes it, so the demo isn't blocked
 * by a header-name mismatch. Tighten this before going live.
 */

const crypto = require("crypto");

const SIGNATURE_HEADER = "signature";
const TIMESTAMP_HEADER = "timestamp";

function computeSignature(payload, timestamp, signatureKey) {
  const t = payload?.data?.transaction || {};
  const m = payload?.data?.merchant || {};

  const hashingPayload = [
    payload.event_type,
    payload.requestId,
    m.userId,
    m.walletId,
    t.transactionId,
    t.type,
    t.time,
    t.responseCode,
  ].join(":");

  const message = `${hashingPayload}:${timestamp}`;

  return crypto.createHmac("sha256", signatureKey).update(message).digest("hex");
}

/**
 * Returns { verified: boolean, reason: string }
 */
function verifyWebhookSignature(req, signatureKey) {
  if (!signatureKey) {
    return { verified: false, reason: "no signature key configured" };
  }

  const receivedSignature = req.headers[SIGNATURE_HEADER];
  const timestamp = req.headers[TIMESTAMP_HEADER];

  if (!receivedSignature || !timestamp) {
    return { verified: false, reason: "missing signature/timestamp header" };
  }

  try {
    const expected = computeSignature(req.body, timestamp, signatureKey);
    const match =
      expected.length === receivedSignature.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(receivedSignature));
    return { verified: match, reason: match ? "ok" : "mismatch" };
  } catch (err) {
    return { verified: false, reason: `error: ${err.message}` };
  }
}

module.exports = { verifyWebhookSignature };
