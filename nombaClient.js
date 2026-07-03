/**
 * Thin client around the Nomba API.
 * Docs: https://developer.nomba.com
 *
 * Endpoints used here are confirmed against Nomba's published API reference
 * (auth, checkout order creation, bank lookup, bank list). The payout
 * (POST /v2/transfers/bank) body fields are best-effort based on the docs
 * available at build time — confirm the exact field names against your
 * Nomba dashboard/API reference before going live, and adjust
 * `initiateBankTransfer` below if your sandbox responds with a validation error.
 */

const BASE_URL = "https://api.nomba.com";

const {
  NOMBA_ACCOUNT_ID,
  NOMBA_CLIENT_ID,
  NOMBA_CLIENT_SECRET,
} = process.env;

let cachedToken = null; // { accessToken, expiresAt }

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.accessToken;
  }

  const res = await fetch(`${BASE_URL}/v1/auth/token/issue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      accountId: NOMBA_ACCOUNT_ID,
    },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: NOMBA_CLIENT_ID,
      client_secret: NOMBA_CLIENT_SECRET,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Nomba auth failed: ${res.status} ${JSON.stringify(json)}`);
  }

  // Response shape can vary slightly; check the common places for the token.
  const accessToken =
    json.access_token || json.data?.access_token || json.data?.accessToken;
  const expiresIn = json.expires_in || json.data?.expires_in || 3300; // fall back ~55 min

  if (!accessToken) {
    throw new Error(`Nomba auth: no access_token in response: ${JSON.stringify(json)}`);
  }

  cachedToken = {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };

  return accessToken;
}

async function nombaRequest(pathName, { method = "GET", body } = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}${pathName}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      accountId: NOMBA_ACCOUNT_ID,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Nomba API ${method} ${pathName} failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

/**
 * Create a hosted checkout order. Returns { checkoutLink, orderReference }.
 */
async function createCheckoutOrder({ orderReference, amount, customerEmail, callbackUrl, productName }) {
  const json = await nombaRequest("/v1/checkout/order", {
    method: "POST",
    body: {
      order: {
        orderReference,
        callbackUrl,
        customerEmail,
        amount: String(amount),
        currency: "NGN",
        accountId: NOMBA_ACCOUNT_ID,
        allowedPaymentMethods: ["Card", "Transfer"],
        orderMetaData: {
          productName,
        },
      },
    },
  });
  return json.data; // { checkoutLink, orderReference }
}

async function listBanks() {
  const json = await nombaRequest("/v1/transfers/bank", { method: "GET" });
  return json.data || [];
}

async function lookupBankAccount({ accountNumber, bankCode }) {
  const json = await nombaRequest("/v1/transfers/bank/lookup", {
    method: "POST",
    body: { accountNumber, bankCode },
  });
  return json.data; // { accountNumber, accountName }
}

/**
 * Release escrowed funds to the seller's bank account.
 * NOTE: field names best-effort — verify against your live API reference.
 */
async function initiateBankTransfer({ amount, accountNumber, bankCode, merchantTxRef, narration }) {
  const json = await nombaRequest("/v2/transfers/bank", {
    method: "POST",
    body: {
      amount,
      accountNumber,
      bankCode,
      merchantTxRef,
      narration: narration || "Amana escrow release",
    },
  });
  return json.data;
}

module.exports = {
  getAccessToken,
  createCheckoutOrder,
  listBanks,
  lookupBankAccount,
  initiateBankTransfer,
};
