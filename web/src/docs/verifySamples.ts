import { nodeVerify, phpVerify, pythonVerify } from '@/lib/snippets'
import type { Sample } from './components/Code'

/*
 * Webhook receivers that verify the v1 signature exactly as specified (docs/API_CONTRACT.md §3–4):
 *   X-NFC-Signature: v1=<lowercase hex HMAC_SHA256(key, "{timestamp}.{nonce}.{raw_body}")>
 *   key (relay)  = the webhook secret string (incl. "whsec_") as UTF-8 bytes
 *   key (direct) = hex(HMAC_SHA256(webhook_secret, "device:" + X-NFC-Device-Id)) — the 64-char hex STRING as UTF-8
 * Each sample: raw body, 5-minute timestamp window, constant-time comparison, notes on nonce/idempotency.
 * String.raw keeps backslashes (regexes) intact; none of the samples contain "${" or backticks.
 */

const shell = String.raw`# Verify a captured request by hand (relay mode) with openssl.
SECRET='whsec_your_webhook_secret'        # the full string, including "whsec_"
TS='1790325021'                           # X-NFC-Timestamp
NONCE='9f86d081884c7d659a2feaa0c55ad015'  # X-NFC-Nonce
SIG='v1=5d41402abc4b2a76b9719d911017c592…' # X-NFC-Signature
# body.json must hold the exact raw bytes you received.
# Direct mode: first derive the key, then use it as SECRET:
#   SECRET=$(printf 'device:%s' "$DEVICE_ID" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')
EXPECTED="v1=$( { printf '%s.%s.' "$TS" "$NONCE"; cat body.json; } | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')"
if [ "$EXPECTED" = "$SIG" ]; then echo "signature valid"; else echo "signature INVALID"; fi
# Also check that TS is within 300 s of now: echo $(( $(date +%s) - TS ))`

const go = String.raw`// Go 1.21+ — net/http
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

var webhookSecret = os.Getenv("NFC_WEBHOOK_SECRET") // whsec_...

func hmacHex(key, msg []byte) string {
	m := hmac.New(sha256.New, key)
	m.Write(msg)
	return hex.EncodeToString(m.Sum(nil))
}

// relay: the webhook secret. direct: the per-device key derived from it (hex string used as UTF-8 bytes).
func signingKey(h http.Header) []byte {
	if h.Get("X-NFC-Delivery-Mode") == "direct" {
		return []byte(hmacHex([]byte(webhookSecret), []byte("device:"+h.Get("X-NFC-Device-Id"))))
	}
	return []byte(webhookSecret)
}

func verify(h http.Header, body []byte) bool {
	ts, nonce, sig := h.Get("X-NFC-Timestamp"), h.Get("X-NFC-Nonce"), h.Get("X-NFC-Signature")
	t, err := strconv.ParseInt(ts, 10, 64)
	if err != nil || !strings.HasPrefix(sig, "v1=") {
		return false
	}
	if d := time.Now().Unix() - t; d > 300 || d < -300 { // 5-minute window
		return false
	}
	msg := append([]byte(ts+"."+nonce+"."), body...) // raw bytes, not re-encoded JSON
	expected := hmacHex(signingKey(h), msg)
	return hmac.Equal([]byte(expected), []byte(sig[3:])) // constant time
}

func main() {
	http.HandleFunc("/api/nfc/card", func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil || !verify(r.Header, body) {
			http.Error(w, "invalid signature", http.StatusUnauthorized)
			return
		}
		// Reject reused X-NFC-Nonce values (e.g. Redis SET NX EX 600) and dedupe on X-NFC-Event-Id.
		log.Println("event", r.Header.Get("X-NFC-Event-Id"))
		w.WriteHeader(http.StatusNoContent)
	})
	log.Fatal(http.ListenAndServe(":3000", nil))
}`

const java = String.raw`// Java 17+ — JDK HttpServer, no dependencies
import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpServer;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

public class NfcWebhook {
  static final String SECRET = System.getenv("NFC_WEBHOOK_SECRET"); // whsec_...

  static String hmacHex(byte[] key, byte[] msg) throws Exception {
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(key, "HmacSHA256"));
    return HexFormat.of().formatHex(mac.doFinal(msg)); // lowercase hex
  }

  static boolean verify(Headers h, byte[] body) throws Exception {
    String ts = h.getFirst("X-NFC-Timestamp"), nonce = h.getFirst("X-NFC-Nonce"), sig = h.getFirst("X-NFC-Signature");
    if (ts == null || nonce == null || sig == null || ts.isEmpty() || !ts.chars().allMatch(Character::isDigit) || !sig.startsWith("v1=")) return false;
    if (Math.abs(System.currentTimeMillis() / 1000 - Long.parseLong(ts)) > 300) return false; // 5-minute window

    // relay: the webhook secret. direct: the per-device key derived from it (hex string used as UTF-8 bytes).
    byte[] key = SECRET.getBytes(StandardCharsets.UTF_8);
    if ("direct".equals(h.getFirst("X-NFC-Delivery-Mode"))) {
      String deviceId = h.getFirst("X-NFC-Device-Id");
      key = hmacHex(key, ("device:" + deviceId).getBytes(StandardCharsets.UTF_8)).getBytes(StandardCharsets.UTF_8);
    }
    byte[] prefix = (ts + "." + nonce + ".").getBytes(StandardCharsets.UTF_8);
    byte[] msg = new byte[prefix.length + body.length]; // raw bytes, not re-encoded JSON
    System.arraycopy(prefix, 0, msg, 0, prefix.length);
    System.arraycopy(body, 0, msg, prefix.length, body.length);
    byte[] expected = hmacHex(key, msg).getBytes(StandardCharsets.UTF_8);
    return MessageDigest.isEqual(expected, sig.substring(3).getBytes(StandardCharsets.UTF_8)); // constant time
  }

  public static void main(String[] args) throws Exception {
    HttpServer server = HttpServer.create(new InetSocketAddress(3000), 0);
    server.createContext("/api/nfc/card", ex -> {
      int status;
      try {
        byte[] body = ex.getRequestBody().readAllBytes();
        status = verify(ex.getRequestHeaders(), body) ? 204 : 401;
        // Reject reused X-NFC-Nonce values and dedupe on X-NFC-Event-Id before processing.
      } catch (Exception e) {
        status = 400;
      }
      ex.sendResponseHeaders(status, -1);
      ex.close();
    });
    server.start();
  }
}`

const csharp = String.raw`// C# — ASP.NET Core 8 minimal API
using System.Security.Cryptography;
using System.Text;

var secret = Environment.GetEnvironmentVariable("NFC_WEBHOOK_SECRET")!; // whsec_...
var app = WebApplication.Create(args);

static string HmacHex(byte[] key, byte[] msg) =>
    Convert.ToHexString(HMACSHA256.HashData(key, msg)).ToLowerInvariant();

app.MapPost("/api/nfc/card", async (HttpRequest req) =>
{
    using var ms = new MemoryStream();
    await req.Body.CopyToAsync(ms); // raw bytes, not re-encoded JSON
    var body = ms.ToArray();

    string ts = req.Headers["X-NFC-Timestamp"].ToString();
    string nonce = req.Headers["X-NFC-Nonce"].ToString();
    string sig = req.Headers["X-NFC-Signature"].ToString();
    if (!long.TryParse(ts, out var t) || Math.Abs(DateTimeOffset.UtcNow.ToUnixTimeSeconds() - t) > 300 || !sig.StartsWith("v1="))
        return Results.Unauthorized();

    // relay: the webhook secret. direct: the per-device key derived from it (hex string used as UTF-8 bytes).
    var key = Encoding.UTF8.GetBytes(secret);
    if (req.Headers["X-NFC-Delivery-Mode"].ToString() == "direct")
        key = Encoding.UTF8.GetBytes(HmacHex(key, Encoding.UTF8.GetBytes("device:" + req.Headers["X-NFC-Device-Id"].ToString())));

    var msg = Encoding.UTF8.GetBytes(ts + "." + nonce + ".").Concat(body).ToArray();
    var expected = Encoding.UTF8.GetBytes(HmacHex(key, msg));
    if (!CryptographicOperations.FixedTimeEquals(expected, Encoding.UTF8.GetBytes(sig[3..]))) // constant time
        return Results.Unauthorized();

    // Reject reused X-NFC-Nonce values and dedupe on X-NFC-Event-Id before processing.
    return Results.NoContent();
});

app.Run("http://0.0.0.0:3000");`

const ruby = String.raw`# Ruby 3 — Sinatra
require "sinatra"
require "openssl"
require "rack/utils"

WEBHOOK_SECRET = ENV.fetch("NFC_WEBHOOK_SECRET") # whsec_...

def hmac_hex(key, msg) = OpenSSL::HMAC.hexdigest("SHA256", key, msg)

def verify_nfc(env, raw_body)
  ts = env["HTTP_X_NFC_TIMESTAMP"].to_s
  nonce = env["HTTP_X_NFC_NONCE"].to_s
  sig = env["HTTP_X_NFC_SIGNATURE"].to_s
  return false unless ts.match?(/\A\d+\z/) && sig.start_with?("v1=")
  return false if (Time.now.to_i - ts.to_i).abs > 300 # 5-minute window

  # relay: the webhook secret. direct: the per-device key derived from it (hex string).
  key = WEBHOOK_SECRET
  key = hmac_hex(WEBHOOK_SECRET, "device:" + env["HTTP_X_NFC_DEVICE_ID"].to_s) if env["HTTP_X_NFC_DELIVERY_MODE"] == "direct"

  expected = hmac_hex(key, "#{ts}.#{nonce}.".b + raw_body.b) # raw bytes, not re-encoded JSON
  Rack::Utils.secure_compare(expected, sig.delete_prefix("v1=")) # constant time
end

post "/api/nfc/card" do
  raw = request.body.read
  halt 401 unless verify_nfc(request.env, raw)
  # Reject reused X-NFC-Nonce values and dedupe on X-NFC-Event-Id before processing.
  status 204
end`

const rust = String.raw`// Rust — axum 0.7
// Cargo.toml: axum = "0.7", tokio = { version = "1", features = ["full"] },
//             hmac = "0.12", sha2 = "0.10", hex = "0.4"
use axum::{body::Bytes, http::{HeaderMap, StatusCode}, routing::post, Router};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::time::{SystemTime, UNIX_EPOCH};

type HmacSha256 = Hmac<Sha256>;

fn hmac_hex(key: &[u8], msg: &[u8]) -> String {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC accepts any key length");
    mac.update(msg);
    hex::encode(mac.finalize().into_bytes())
}

fn header<'a>(h: &'a HeaderMap, name: &str) -> &'a str {
    h.get(name).and_then(|v| v.to_str().ok()).unwrap_or("")
}

fn verify(h: &HeaderMap, body: &[u8], secret: &str) -> bool {
    let (ts, nonce, sig) = (header(h, "x-nfc-timestamp"), header(h, "x-nfc-nonce"), header(h, "x-nfc-signature"));
    let Ok(t) = ts.parse::<i64>() else { return false };
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
    if (now - t).abs() > 300 { return false; } // 5-minute window
    let Some(received) = sig.strip_prefix("v1=") else { return false };

    // relay: the webhook secret. direct: the per-device key derived from it (hex string used as UTF-8 bytes).
    let key = if header(h, "x-nfc-delivery-mode") == "direct" {
        hmac_hex(secret.as_bytes(), format!("device:{}", header(h, "x-nfc-device-id")).as_bytes())
    } else {
        secret.to_string()
    };
    let mut mac = HmacSha256::new_from_slice(key.as_bytes()).unwrap();
    mac.update(format!("{ts}.{nonce}.").as_bytes());
    mac.update(body); // raw bytes, not re-encoded JSON
    match hex::decode(received) {
        Ok(bytes) => mac.verify_slice(&bytes).is_ok(), // constant time
        Err(_) => false,
    }
}

async fn nfc_card(headers: HeaderMap, body: Bytes) -> StatusCode {
    let secret = std::env::var("NFC_WEBHOOK_SECRET").unwrap_or_default(); // whsec_...
    if !verify(&headers, &body, &secret) {
        return StatusCode::UNAUTHORIZED;
    }
    // Reject reused X-NFC-Nonce values and dedupe on X-NFC-Event-Id before processing.
    StatusCode::NO_CONTENT
}

#[tokio::main]
async fn main() {
    let app = Router::new().route("/api/nfc/card", post(nfc_card));
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}`

const kotlin = String.raw`// Kotlin — Ktor 2 (Netty)
import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.math.abs

val webhookSecret: String = System.getenv("NFC_WEBHOOK_SECRET") // whsec_...

fun hmacHex(key: ByteArray, msg: ByteArray): String {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(key, "HmacSHA256"))
    return mac.doFinal(msg).joinToString("") { "%02x".format(it) } // lowercase hex
}

fun verify(headers: Headers, body: ByteArray): Boolean {
    val ts = headers["X-NFC-Timestamp"] ?: return false
    val nonce = headers["X-NFC-Nonce"] ?: return false
    val sig = headers["X-NFC-Signature"] ?: return false
    val t = ts.toLongOrNull() ?: return false
    if (abs(System.currentTimeMillis() / 1000 - t) > 300 || !sig.startsWith("v1=")) return false // 5-minute window

    // relay: the webhook secret. direct: the per-device key derived from it (hex string used as UTF-8 bytes).
    var key = webhookSecret.toByteArray(Charsets.UTF_8)
    if (headers["X-NFC-Delivery-Mode"] == "direct") {
        val deviceId = headers["X-NFC-Device-Id"].orEmpty()
        key = hmacHex(key, ("device:" + deviceId).toByteArray(Charsets.UTF_8)).toByteArray(Charsets.UTF_8)
    }
    val msg = (ts + "." + nonce + ".").toByteArray(Charsets.UTF_8) + body // raw bytes, not re-encoded JSON
    val expected = hmacHex(key, msg).toByteArray(Charsets.UTF_8)
    return MessageDigest.isEqual(expected, sig.removePrefix("v1=").toByteArray(Charsets.UTF_8)) // constant time
}

fun main() {
    embeddedServer(Netty, port = 3000) {
        routing {
            post("/api/nfc/card") {
                val body = call.receive<ByteArray>()
                if (!verify(call.request.headers, body)) {
                    call.respond(HttpStatusCode.Unauthorized)
                    return@post
                }
                // Reject reused X-NFC-Nonce values and dedupe on X-NFC-Event-Id before processing.
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }.start(wait = true)
}`

/** Full webhook receivers (verification + handler) in every documented language. */
export const verifySamplesAll: Sample[] = [
  { label: 'Python', language: 'python', code: pythonVerify },
  { label: 'Node.js', language: 'javascript', code: nodeVerify },
  { label: 'PHP', language: 'php', code: phpVerify },
  { label: 'Go', language: 'go', code: go },
  { label: 'Java', language: 'java', code: java },
  { label: 'C#', language: 'csharp', code: csharp },
  { label: 'Ruby', language: 'ruby', code: ruby },
  { label: 'Rust', language: 'rust', code: rust },
  { label: 'Kotlin', language: 'kotlin', code: kotlin },
  { label: 'Shell', language: 'bash', code: shell },
]

/** Same, without the shell debugging snippet (for places that show "a receiver"). */
export const receiverSamples: Sample[] = verifySamplesAll.filter((s) => s.label !== 'Shell')
