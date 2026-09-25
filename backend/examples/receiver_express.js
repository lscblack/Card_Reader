// Minimal webhook receiver that verifies NFC Platform signatures (relay + direct modes).
//
//   npm install express
//   NFC_WEBHOOK_SECRET=whsec_... node receiver_express.js
//
// Endpoint: http://<host>:9000/api/nfc/card
const crypto = require("crypto");

const WEBHOOK_SECRET = process.env.NFC_WEBHOOK_SECRET || "";
const TOLERANCE_SECONDS = 300;
const seenNonces = new Map(); // use Redis (SET NX EX 300) in production
const seenEvents = new Set(); // use your database in production

function hmacHex(key, message) {
  return crypto.createHmac("sha256", key).update(message).digest("hex");
}

// Direct mode: hex(HMAC_SHA256(key=webhook_secret, msg="device:" + device_id))
function deviceSigningSecret(webhookSecret, deviceId) {
  return hmacHex(webhookSecret, `device:${deviceId}`);
}

function verifySignature(webhookSecret, headers, rawBody, now = Date.now() / 1000) {
  const timestamp = headers["x-nfc-timestamp"];
  const nonce = headers["x-nfc-nonce"];
  const signature = headers["x-nfc-signature"] || "";
  const mode = headers["x-nfc-delivery-mode"] || "relay";
  if (!timestamp || !nonce) return false;
  if (Math.abs(now - Number(timestamp)) > TOLERANCE_SECONDS) return false;

  const key = mode === "direct" ? deviceSigningSecret(webhookSecret, headers["x-nfc-device-id"] || "") : webhookSecret;
  const expected = "v1=" + hmacHex(key, Buffer.concat([Buffer.from(`${timestamp}.${nonce}.`), rawBody]));
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function main() {
  const express = require("express");
  const app = express();
  // Keep the RAW body: the signature covers the exact bytes sent.
  app.use("/api/nfc/card", express.raw({ type: "application/json", limit: "1mb" }));

  app.post("/api/nfc/card", (req, res) => {
    if (!verifySignature(WEBHOOK_SECRET, req.headers, req.body)) {
      return res.status(401).json({ error: "invalid signature" });
    }
    const now = Date.now() / 1000;
    for (const [n, ts] of seenNonces) if (now - ts > TOLERANCE_SECONDS) seenNonces.delete(n);
    const nonce = req.headers["x-nfc-nonce"];
    if (seenNonces.has(nonce)) return res.status(409).json({ error: "replayed nonce" });
    seenNonces.set(nonce, now);

    const eventId = req.headers["x-nfc-event-id"];
    if (seenEvents.has(eventId)) return res.json({ ok: true, duplicate: true }); // 2xx stops retries
    seenEvents.add(eventId);

    const payload = JSON.parse(req.body.toString("utf8"));
    // A UID is an identifier, not proof of identity (security.authenticated is false).
    console.log(`card ${payload.card_id} on device ${payload.device_id} (test=${payload.test})`);
    res.json({ ok: true });
  });

  app.listen(9000, () => console.log("NFC receiver listening on :9000"));
}

if (require.main === module) main();

module.exports = { verifySignature, deviceSigningSecret };
