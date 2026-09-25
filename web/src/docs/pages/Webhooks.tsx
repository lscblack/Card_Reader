import { sampleHeaders, samplePayload } from '@/lib/snippets'
import { verifySamplesAll } from '../verifySamples'
import { CodeBlock, CodeTabs, type Sample } from '../components/Code'
import { B, C, Callout, DocHeader, DocLink, H2, P, PrevNext, Table, UL } from '../components/Prose'

const signCli = `# Reproduce a signature by hand (relay mode) — useful for debugging.
SECRET='whsec_your_webhook_secret'           # the full string, including "whsec_"
TS='1790325021'                              # X-NFC-Timestamp
NONCE='9f86d081884c7d659a2feaa0c55ad015'     # X-NFC-Nonce
# body.json must contain the exact raw bytes you received
{ printf '%s.%s.' "$TS" "$NONCE"; cat body.json; } \\
  | openssl dgst -sha256 -hmac "$SECRET" | awk '{print "v1=" $NF}'`

const deriveSamples: Sample[] = [
  {
    label: 'Shell',
    language: 'bash',
    code: `# device_signing_secret = hex(HMAC_SHA256(key=webhook_secret, msg="device:" + device_id))
DEVICE_ID='5b0e7c1a-2f3d-4e5f-8a9b-0c1d2e3f4a5b'   # X-NFC-Device-Id (lowercase, hyphenated)
printf 'device:%s' "$DEVICE_ID" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}'`,
  },
  {
    label: 'Python',
    language: 'python',
    code: `import hashlib, hmac

def device_signing_secret(webhook_secret: str, device_id: str) -> str:
    # key = webhook secret as UTF-8 (incl. "whsec_"); result = 64-char lowercase hex STRING
    return hmac.new(webhook_secret.encode(), f"device:{device_id}".encode(), hashlib.sha256).hexdigest()

# Then verify with that hex string (UTF-8 encoded) as the HMAC key — do NOT hex-decode it.`,
  },
  {
    label: 'Node.js',
    language: 'javascript',
    code: `import crypto from "node:crypto";

// key = webhook secret as UTF-8 (incl. "whsec_"); result = 64-char lowercase hex STRING
const deviceSigningSecret = (webhookSecret, deviceId) =>
  crypto.createHmac("sha256", webhookSecret).update("device:" + deviceId).digest("hex");

// Then verify with that hex string as the HMAC key — do NOT Buffer.from(hex, "hex") it.`,
  },
  {
    label: 'PHP',
    language: 'php',
    code: `<?php
// key = webhook secret (incl. "whsec_"); result = 64-char lowercase hex STRING
function device_signing_secret(string $webhookSecret, string $deviceId): string {
    return hash_hmac('sha256', 'device:' . $deviceId, $webhookSecret);
}
// Then verify with that hex string as the HMAC key — do NOT hex2bin() it.`,
  },
  {
    label: 'Go',
    language: 'go',
    code: `// key = webhook secret as UTF-8 (incl. "whsec_"); result = 64-char lowercase hex STRING
func deviceSigningSecret(webhookSecret, deviceID string) string {
	m := hmac.New(sha256.New, []byte(webhookSecret))
	m.Write([]byte("device:" + deviceID))
	return hex.EncodeToString(m.Sum(nil))
}
// Then verify with []byte(thatHexString) as the HMAC key — do NOT hex.DecodeString it.`,
  },
  {
    label: 'Java',
    language: 'java',
    code: `// key = webhook secret as UTF-8 (incl. "whsec_"); result = 64-char lowercase hex STRING
static String deviceSigningSecret(String webhookSecret, String deviceId) throws Exception {
  Mac mac = Mac.getInstance("HmacSHA256");
  mac.init(new SecretKeySpec(webhookSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
  return HexFormat.of().formatHex(mac.doFinal(("device:" + deviceId).getBytes(StandardCharsets.UTF_8)));
}
// Then verify with thatHexString.getBytes(UTF_8) as the HMAC key — do NOT parse the hex.`,
  },
  {
    label: 'C#',
    language: 'csharp',
    code: `// key = webhook secret as UTF-8 (incl. "whsec_"); result = 64-char lowercase hex STRING
static string DeviceSigningSecret(string webhookSecret, string deviceId) =>
    Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(webhookSecret),
        Encoding.UTF8.GetBytes("device:" + deviceId))).ToLowerInvariant();
// Then verify with Encoding.UTF8.GetBytes(thatHexString) as the HMAC key — do NOT Convert.FromHexString it.`,
  },
  {
    label: 'Ruby',
    language: 'ruby',
    code: `# key = webhook secret (incl. "whsec_"); result = 64-char lowercase hex STRING
def device_signing_secret(webhook_secret, device_id)
  OpenSSL::HMAC.hexdigest("SHA256", webhook_secret, "device:" + device_id)
end
# Then verify with that hex string as the HMAC key — do NOT [hex].pack("H*") it.`,
  },
  {
    label: 'Rust',
    language: 'rust',
    code: `// key = webhook secret as UTF-8 (incl. "whsec_"); result = 64-char lowercase hex STRING
fn device_signing_secret(webhook_secret: &str, device_id: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(webhook_secret.as_bytes()).unwrap();
    mac.update(format!("device:{device_id}").as_bytes());
    hex::encode(mac.finalize().into_bytes())
}
// Then verify with that_hex_string.as_bytes() as the HMAC key — do NOT hex::decode it.`,
  },
  {
    label: 'Kotlin',
    language: 'kotlin',
    code: `// key = webhook secret as UTF-8 (incl. "whsec_"); result = 64-char lowercase hex STRING
fun deviceSigningSecret(webhookSecret: String, deviceId: String): String {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(webhookSecret.toByteArray(Charsets.UTF_8), "HmacSHA256"))
    return mac.doFinal(("device:" + deviceId).toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
}
// Then verify with thatHexString.toByteArray(UTF_8) as the HMAC key — do NOT decode the hex.`,
  },
]

export default function Webhooks() {
  return (
    <article>
      <DocHeader slug="webhooks" />

      <H2 id="payload">Payload</H2>
      <P>
        Your endpoint receives <C>POST</C> with <C>Content-Type: application/json</C>:
      </P>
      <CodeBlock language="json" title="card.detected" code={samplePayload} />
      <Table
        head={['Field', 'Description']}
        rows={[
          [<C key="f">event_id</C>, 'UUID generated on the phone. Stable across retries — use it for idempotency.'],
          [<C key="f">event</C>, <><C>card.detected</C>; <C>endpoint.test</C> for test deliveries; <C>card.tapped</C> for business <C>developer_webhook</C> actions.</>],
          [<C key="f">card_id</C>, 'Uppercase hex UID without separators (same as card.uid).'],
          [<C key="f">card.technologies</C>, <>Android tech list, e.g. <C>NfcA</C>, <C>MifareUltralight</C>.</>],
          [<C key="f">card.type</C>, <>Best-effort card family; may be <C>null</C>.</>],
          [<C key="f">security</C>, <><C>authenticated: false</C>, <C>level: &quot;uid_only&quot;</C> — see <DocLink to="/docs/security#uid">Security</DocLink>.</>],
          [<C key="f">device_id</C>, 'Device UUID (all zeros for test events).'],
          [<C key="f">delivery_mode</C>, <><C>relay</C> or <C>direct</C>.</>],
          [<C key="f">test</C>, <><C>true</C> only for test events (<C>card_id</C> <C>TEST0000</C>).</>],
          [<C key="f">timestamp</C>, 'When the card was detected (ISO-8601 UTC).'],
        ]}
      />

      <H2 id="headers">Headers</H2>
      <Table
        head={['Header', 'Value']}
        rows={[
          [<C key="h">User-Agent</C>, <><C>NFCPlatform-Webhook/1.0</C> (relay) or <C>NFCPlatform-Terminal/1.0</C> (direct)</>],
          [<C key="h">X-NFC-Event-Id</C>, 'Event UUID — use for idempotency; retries reuse it'],
          [<C key="h">X-NFC-Timestamp</C>, 'Unix seconds (string)'],
          [<C key="h">X-NFC-Nonce</C>, '32 hex chars, random per attempt'],
          [<C key="h">X-NFC-Device-Id</C>, 'Device UUID'],
          [<C key="h">X-NFC-Delivery-Mode</C>, <><C>relay</C> or <C>direct</C></>],
          [<C key="h">X-NFC-Signature</C>, <><C>v1=</C> + lowercase hex HMAC-SHA256 (see below)</>],
        ]}
      />
      <CodeBlock language="http" title="Example request" code={sampleHeaders} />

      <H2 id="signature-scheme">Signature scheme</H2>
      <CodeBlock language="text" title="v1" code={'X-NFC-Signature: v1=<hex HMAC_SHA256(key, "{timestamp}.{nonce}.{raw_body}")>'} />
      <UL>
        <li>
          <B>Message</B>: the <C>X-NFC-Timestamp</C> value, a dot, the <C>X-NFC-Nonce</C> value, a dot, then the <B>raw request body bytes</B>.
          Parsing and re-serialising JSON changes whitespace and breaks the signature.
        </li>
        <li>
          <B>Key</B>: the secret <B>string encoded as UTF-8</B>. In relay mode that is the full webhook secret <em>including</em> its{' '}
          <C>whsec_</C> prefix. In direct mode it is the per-device key below.
        </li>
        <li>
          <B>Output</B>: lowercase hex, prefixed with <C>v1=</C>. Compare in constant time.
        </li>
      </UL>
      <CodeBlock language="bash" title="Debug a signature with openssl" code={signCli} />

      <H2 id="direct-key">Direct-mode derived key</H2>
      <P>
        In direct mode the phone signs with a per-device key; the master webhook secret never reaches the phone. Derive the same key from your
        webhook secret and the <C>X-NFC-Device-Id</C> header:
      </P>
      <CodeBlock language="text" title="derivation" code={'device_signing_secret = hex(HMAC_SHA256(key = webhook_secret, msg = "device:" + device_id))'} />
      <UL>
        <li>
          <C>device_id</C> is the lowercase, hyphenated UUID.
        </li>
        <li>
          The result is a 64-char lowercase hex <B>string</B>, and that string itself (UTF-8) is the HMAC key — <B>not</B> hex-decoded.
        </li>
        <li>
          Also check that <C>device_id</C> in the body equals <C>X-NFC-Device-Id</C>: the key only proves which device signed.
        </li>
      </UL>
      <CodeTabs samples={deriveSamples} title="derive key" />

      <H2 id="verify">Verification code</H2>
      <P>Complete receivers that handle both modes, check freshness, compare in constant time and reject replays:</P>
      <CodeTabs samples={verifySamplesAll} title="verify" />

      <H2 id="replay">Replay protection</H2>
      <UL>
        <li>
          Reject requests whose <C>X-NFC-Timestamp</C> is more than <B>5 minutes</B> from your clock.
        </li>
        <li>
          Remember every <C>X-NFC-Nonce</C> you accept for at least that window (e.g. Redis <C>SET nonce 1 NX EX 600</C>) and reject repeats.
        </li>
        <li>Together these stop a captured request from being replayed, even though the body is identical.</li>
      </UL>

      <H2 id="idempotency">Idempotency &amp; retries</H2>
      <UL>
        <li>
          Retries reuse <C>X-NFC-Event-Id</C> / <C>event_id</C> but get a fresh timestamp, nonce and signature. Store processed IDs and return{' '}
          <C>2xx</C> for duplicates without re-processing.
        </li>
        <li>
          <B>Relay</B> retries server-side with exponential backoff (10 s, 60 s, 300 s…) up to the configured maximum. You can also redeliver
          from the dashboard (<C>POST /events/{'{id}'}/redeliver</C>).
        </li>
        <li>
          <B>Direct</B> retries on the phone (5 s, 30 s, 2 min, then every 10 min), including after the phone comes back online.
        </li>
        <li>
          Redirects are not followed. Failed attempts carry an <C>error_code</C> and <C>error_ref</C> such as <C>delivery_timeout</C> — see{' '}
          <DocLink to="/docs/errors">Error codes</DocLink>.
        </li>
      </UL>

      <H2 id="responding">Responding</H2>
      <P>
        Any <C>2xx</C> means delivered. Anything else, a redirect or a timeout (the endpoint timeout is 1–30 s, default 10 s) is a failure.
        Respond quickly and do heavy work asynchronously. Keep response bodies small — only a short excerpt is stored, and oversized responses are reported with the error code{' '}
        <C>delivery_response_too_large</C>.
      </P>
      <Callout tone="warning" title="Use the raw body">
        Frameworks that parse JSON before your handler runs (Express <C>json()</C>, Django <C>request.POST</C>, Laravel <C>$request-&gt;all()</C>)
        lose the exact bytes. Read the raw body (<C>express.raw()</C>, <C>request.get_data()</C>, <C>php://input</C>).
      </Callout>

      <H2 id="test-events">Test events</H2>
      <P>
        <B>Send test event</B> in the dashboard (or <C>POST /applications/{'{id}'}/endpoint/test</C>) delivers a signed{' '}
        <C>endpoint.test</C> event with <C>test: true</C>, <C>card_id</C> <C>TEST0000</C> and <C>device_id</C>{' '}
        <C>00000000-0000-0000-0000-000000000000</C>. It returns <C>{'{ success, status_code, latency_ms, error, response_excerpt }'}</C>. To see
        exactly what is sent, point the application at a <DocLink to="/docs/sandbox">sandbox endpoint</DocLink>.
      </P>
      <PrevNext slug="webhooks" />
    </article>
  )
}
