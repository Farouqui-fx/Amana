const express = require("express");
const { nanoid } = require("nanoid");
const db = require("../db");
const nomba = require("../nombaClient");

const router = express.Router();

const { FRONTEND_BASE_URL } = process.env;

// --- Create an order (seller) ---------------------------------------------
router.post("/orders", (req, res) => {
  const { productName, price, sellerName, sellerHandle, sellerBankAccount, sellerBankCode, sellerBankName, buyerEmail } = req.body;

  if (!productName || !price || !sellerBankAccount || !sellerBankCode) {
    return res.status(400).json({ error: "productName, price, sellerBankAccount and sellerBankCode are required" });
  }

  const id = nanoid(10);
  const order = {
    id,
    orderReference: `amana-${id}`,
    productName,
    price: Number(price),
    sellerName: sellerName || "",
    sellerHandle: sellerHandle || "",
    sellerBankAccount,
    sellerBankCode,
    sellerBankName: sellerBankName || "",
    buyerEmail: buyerEmail || "",
    status: "created", // created -> awaiting_payment -> held_in_escrow -> released | disputed
    checkoutLink: null,
    transactionRef: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  db.createOrder(order);

  const shareLink = `${FRONTEND_BASE_URL}/order.html?id=${id}`;
  res.status(201).json({ ...order, shareLink });
});

// --- List orders (seller dashboard) ---------------------------------------
router.get("/orders", (_req, res) => {
  res.json(db.listOrders());
});

// --- Get a single order -----------------------------------------------------
router.get("/orders/:id", (req, res) => {
  const order = db.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "order not found" });
  res.json(order);
});

// --- Buyer initiates payment: create a Nomba checkout order ---------------
router.post("/orders/:id/pay", async (req, res) => {
  const order = db.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "order not found" });
  if (order.status !== "created" && order.status !== "awaiting_payment") {
    return res.status(400).json({ error: `order is already ${order.status}` });
  }

  try {
    const checkout = await nomba.createCheckoutOrder({
      orderReference: order.orderReference,
      amount: order.price,
      customerEmail: order.buyerEmail || req.body.buyerEmail || "buyer@amana.app",
      // Where the buyer's BROWSER is redirected after they finish paying on
      // Nomba's hosted checkout page. This is separate from the server-to-server
      // webhook (configured in the Nomba dashboard) that actually confirms payment.
      callbackUrl: `${FRONTEND_BASE_URL}/order.html?id=${order.id}`,
      productName: order.productName,
    });

    const updated = db.updateOrder(order.id, {
      status: "awaiting_payment",
      checkoutLink: checkout.checkoutLink,
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Failed to create Nomba checkout order", detail: err.message });
  }
});

// --- Buyer confirms delivery: release escrow to seller ---------------------
router.post("/orders/:id/confirm-delivery", async (req, res) => {
  const order = db.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "order not found" });
  if (order.status !== "held_in_escrow") {
    return res.status(400).json({ error: `order must be held_in_escrow to release (currently ${order.status})` });
  }

  try {
    const payout = await nomba.initiateBankTransfer({
      amount: order.price,
      accountNumber: order.sellerBankAccount,
      bankCode: order.sellerBankCode,
      merchantTxRef: `${order.orderReference}-release`,
      narration: `Amana release for ${order.productName}`,
    });

    const updated = db.updateOrder(order.id, {
      status: "released",
      releasedAt: new Date().toISOString(),
      payoutRef: payout?.transactionId || payout?.reference || null,
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Failed to release funds via Nomba transfer", detail: err.message });
  }
});

// --- Manual/demo override: mark as paid without waiting for a real webhook.
// Handy for judging/demo environments where a public webhook URL isn't reachable.
router.post("/orders/:id/simulate-payment", (req, res) => {
  const order = db.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "order not found" });
  const updated = db.updateOrder(order.id, {
    status: "held_in_escrow",
    paidAt: new Date().toISOString(),
    transactionRef: `SIMULATED-${nanoid(8)}`,
  });
  res.json(updated);
});

// --- Bank helpers for the seller's order-creation form ----------------------
router.get("/banks", async (_req, res) => {
  try {
    const banks = await nomba.listBanks();
    res.json(banks);
  } catch (err) {
    res.status(502).json({ error: "Failed to fetch bank list", detail: err.message });
  }
});

router.post("/banks/lookup", async (req, res) => {
  const { accountNumber, bankCode } = req.body;
  if (!accountNumber || !bankCode) {
    return res.status(400).json({ error: "accountNumber and bankCode are required" });
  }
  try {
    const result = await nomba.lookupBankAccount({ accountNumber, bankCode });
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: "Bank lookup failed", detail: err.message });
  }
});

module.exports = router;
