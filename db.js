const fs = require("fs");
const path = require("path");

const DB_FILE = path.join(__dirname, "..", "data", "orders.json");

function readAll() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ orders: [] }, null, 2));
  }
  const raw = fs.readFileSync(DB_FILE, "utf-8");
  try {
    return JSON.parse(raw);
  } catch {
    return { orders: [] };
  }
}

function writeAll(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function listOrders() {
  return readAll().orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function getOrder(id) {
  return readAll().orders.find((o) => o.id === id) || null;
}

function getOrderByReference(orderReference) {
  return readAll().orders.find((o) => o.orderReference === orderReference) || null;
}

function createOrder(order) {
  const data = readAll();
  data.orders.push(order);
  writeAll(data);
  return order;
}

function updateOrder(id, patch) {
  const data = readAll();
  const idx = data.orders.findIndex((o) => o.id === id);
  if (idx === -1) return null;
  data.orders[idx] = { ...data.orders[idx], ...patch, updatedAt: new Date().toISOString() };
  writeAll(data);
  return data.orders[idx];
}

module.exports = { listOrders, getOrder, getOrderByReference, createOrder, updateOrder };
