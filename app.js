const API = ""; // same-origin, served by the Express server

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API}/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Request failed (${res.status})`);
  }
  return json;
}

function formatNaira(amount) {
  return `₦${Number(amount).toLocaleString("en-NG", { minimumFractionDigits: 0 })}`;
}

const STATUS_LABEL = {
  created: "Awaiting payment",
  awaiting_payment: "Awaiting payment",
  held_in_escrow: "Funds held in escrow",
  released: "Released to seller",
};

function statusLabel(status) {
  return STATUS_LABEL[status] || status;
}
