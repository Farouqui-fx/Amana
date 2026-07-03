require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const ordersRouter = require("./src/routes/orders");
const webhookRouter = require("./src/routes/webhook");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());

// Capture the raw body for webhook signature verification, while still
// parsing JSON for every route.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString("utf-8");
    },
  })
);

app.use("/api", ordersRouter);
app.use("/api", webhookRouter);

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "amana-escrow" }));

// Serve the frontend
app.use(express.static(path.join(__dirname, "..", "frontend")));

app.listen(PORT, () => {
  console.log(`Amana escrow server running on http://localhost:${PORT}`);
});
