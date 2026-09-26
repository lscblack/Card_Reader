import { createContext, useContext, useId, type ReactNode } from 'react'

/*
 * Theme-aware SVG diagrams (colours come from CSS tokens). Each has <title>/<desc> for screen readers.
 * Coordinates use a 720-wide viewBox; the Figure wrapper keeps a min width + zoom on small screens.
 */

type Tone = 'default' | 'accent' | 'muted' | 'ok'

const MarkerContext = createContext({ normal: '', accent: '' })

function Box({ x, y, w, h = 56, title, sub, tone = 'default' }: { x: number; y: number; w: number; h?: number; title: string; sub?: string; tone?: Tone }) {
  const fill = tone === 'accent' ? 'var(--accent-soft)' : tone === 'muted' ? 'var(--surface-2)' : tone === 'ok' ? 'color-mix(in oklab, #10b981 12%, var(--surface))' : 'var(--surface)'
  const stroke = tone === 'accent' ? 'var(--accent)' : tone === 'ok' ? '#10b981' : 'var(--border-strong)'
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="10" fill={fill} stroke={stroke} strokeWidth="1.5" />
      <text x={x + w / 2} y={sub ? y + h / 2 - 4 : y + h / 2 + 5} textAnchor="middle" fontSize="14" fontWeight="600" fill="var(--fg)">
        {title}
      </text>
      {sub && (
        <text x={x + w / 2} y={y + h / 2 + 14} textAnchor="middle" fontSize="11.5" fill="var(--muted)">
          {sub}
        </text>
      )}
    </g>
  )
}

function Arrow({ d, label, lx, ly, accent, dashed, anchor = 'middle' }: { d: string; label?: string; lx?: number; ly?: number; accent?: boolean; dashed?: boolean; anchor?: 'start' | 'middle' | 'end' }) {
  return (
    <g>
      <ArrowPath d={d} accent={accent} dashed={dashed} />
      {label && lx != null && ly != null && (
        <text x={lx} y={ly} textAnchor={anchor} fontSize="11.5" fill={accent ? 'var(--accent)' : 'var(--muted)'} fontWeight={accent ? 600 : 400}>
          {label}
        </text>
      )}
    </g>
  )
}

function ArrowPath({ d, accent, dashed }: { d: string; accent?: boolean; dashed?: boolean }) {
  const markers = useContext(MarkerContext)
  return (
    <path
      d={d}
      fill="none"
      stroke={accent ? 'var(--accent)' : 'var(--muted)'}
      strokeWidth={accent ? 2 : 1.5}
      strokeDasharray={dashed ? '5 5' : undefined}
      markerEnd={accent ? markers.accent : markers.normal}
    />
  )
}

function Diagram({ h, title, desc, children }: { h: number; title: string; desc: string; children: (m: { normal: string; accent: string }) => ReactNode }) {
  const id = useId()
  const markers = { normal: `url(#${id}-m)`, accent: `url(#${id}-ma)` }
  return (
    <svg viewBox={`0 0 720 ${h}`} className="block h-auto w-full" role="img" aria-labelledby={`${id}-t ${id}-d`}>
      <title id={`${id}-t`}>{title}</title>
      <desc id={`${id}-d`}>{desc}</desc>
      <defs>
        <marker id={`${id}-m`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill="var(--muted)" />
        </marker>
        <marker id={`${id}-ma`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill="var(--accent)" />
        </marker>
      </defs>
      <MarkerContext.Provider value={markers}>{children(markers)}</MarkerContext.Provider>
    </svg>
  )
}

export function ArchitectureDiagram() {
  return (
    <Diagram
      h={330}
      title="Architecture"
      desc="An NFC card is read by an Android phone running nexTap. In relay mode the phone sends the event to the platform, which signs and delivers it to your endpoint with retries. In direct mode the phone signs and posts to your endpoint itself and reports the result. Customers' phones open a card's tap link, which runs the configured action."
    >
      {() => (
        <>
          <Box x={10} y={40} w={120} title="NFC card / tag" sub="UID, NDEF link" tone="muted" />
          <Box x={190} y={40} w={150} title="Android phone" sub="nexTap app" />
          <Box x={400} y={40} w={150} title="Platform API" sub="sign · log · retry" tone="accent" />
          <Box x={600} y={40} w={110} title="Your endpoint" sub="HTTPS" tone="ok" />
          <Arrow d="M130 68 H186" label="tap" lx={158} ly={60} />
          <Arrow d="M340 62 H396" label="relay" lx={368} ly={54} accent />
          <Arrow d="M550 62 H596" label="signed" lx={573} ly={54} accent />
          <Arrow d="M265 96 V130 H655 V100" dashed label="direct: phone signs with a per-device key and posts itself" lx={460} ly={124} />
          <Box x={400} y={170} w={150} title="Dashboard" sub="events · analytics" />
          <Arrow d="M475 166 V100" label="" />
          <Box x={10} y={250} w={170} title="Customer's phone" sub="taps a business card" tone="muted" />
          <Box x={250} y={250} w={170} title="GET /t/{code}" sub="records a web tap" tone="accent" />
          <Box x={490} y={250} w={220} title="Action" sub="profile · WhatsApp · Wi-Fi · vCard…" tone="ok" />
          <Arrow d="M180 278 H246" label="opens link" lx={213} ly={270} />
          <Arrow d="M420 278 H486" label="302 / page" lx={453} ly={270} accent />
          <Arrow d="M335 246 V226 H475" dashed />
        </>
      )}
    </Diagram>
  )
}

export function RelayDirectDiagram() {
  return (
    <Diagram
      h={300}
      title="Relay versus direct delivery"
      desc="Relay: phone to platform to your endpoint; the platform signs with the webhook secret and retries server-side at 10, 60 and 300 seconds. Direct: the phone signs with a per-device derived key and posts to your endpoint, retries on the phone, then reports the outcome to the platform for logging."
    >
      {() => (
        <>
          <text x="10" y="24" fontSize="13" fontWeight="700" fill="var(--accent)">
            RELAY (default)
          </text>
          <Box x={10} y={40} w={150} title="Phone" sub="POST /device/events" />
          <Box x={285} y={40} w={150} title="Platform" sub="signs with whsec_…" tone="accent" />
          <Box x={560} y={40} w={150} title="Your endpoint" sub="verifies v1=" tone="ok" />
          <Arrow d="M160 68 H281" label="event (device token)" lx={220} ly={60} />
          <Arrow d="M435 68 H556" label="signed POST" lx={495} ly={60} accent />
          <Arrow d="M560 90 C500 130 440 130 380 96" dashed label="non-2xx / timeout → retry 10 s, 60 s, 300 s…" lx={470} ly={134} />
          <line x1="10" y1="160" x2="710" y2="160" stroke="var(--border)" />
          <text x="10" y="190" fontSize="13" fontWeight="700" fill="var(--accent)">
            DIRECT
          </text>
          <Box x={10} y={205} w={150} title="Phone" sub="signs with device key" tone="accent" />
          <Box x={560} y={205} w={150} title="Your endpoint" sub="derives the same key" tone="ok" />
          <Box x={285} y={235} w={150} h={50} title="Platform" sub="logs the outcome" />
          <Arrow d="M160 225 H556" label="signed POST (phone retries: 5 s, 30 s, 2 min…)" lx={358} ly={217} accent />
          <Arrow d="M160 250 H281" label="report" lx={220} ly={272} dashed />
        </>
      )}
    </Diagram>
  )
}

export function SignatureDiagram() {
  return (
    <Diagram
      h={250}
      title="How the v1 signature is computed"
      desc="The message is the X-NFC-Timestamp value, a dot, the X-NFC-Nonce value, a dot, and the raw request body. It is signed with HMAC-SHA256 using the key as UTF-8 bytes: the webhook secret in relay mode, or the derived per-device key in direct mode. The lowercase hex digest prefixed with v1= is sent in X-NFC-Signature."
    >
      {() => (
        <>
          <Box x={10} y={20} w={150} h={46} title="X-NFC-Timestamp" sub="1790325021" tone="muted" />
          <Box x={10} y={80} w={150} h={46} title="X-NFC-Nonce" sub="9f86d0…ad015" tone="muted" />
          <Box x={10} y={140} w={150} h={46} title="raw body bytes" sub="exactly as received" tone="muted" />
          <Box x={230} y={70} w={190} h={66} title={'"{ts}.{nonce}.{body}"'} sub="message" />
          <Arrow d="M160 43 C200 43 200 90 226 95" />
          <Arrow d="M160 103 H226" />
          <Arrow d="M160 163 C200 163 200 115 226 112" />
          <Box x={480} y={70} w={110} h={66} title="HMAC" sub="SHA-256" tone="accent" />
          <Arrow d="M420 103 H476" accent />
          <Box x={450} y={170} w={170} h={60} title="key (UTF-8 bytes)" sub="whsec_… or device key hex" />
          <Arrow d="M535 166 V140" accent />
          <Box x={620} y={70} w={90} h={66} title="v1=…" sub="lowercase hex" tone="ok" />
          <Arrow d="M590 103 H616" accent />
          <text x="10" y="222" fontSize="11.5" fill="var(--muted)">
            Direct mode key = hex(HMAC_SHA256(webhook_secret, &quot;device:&quot; + device_id))
          </text>
        </>
      )}
    </Diagram>
  )
}

export function PairingSequenceDiagram() {
  const lanes = [
    { x: 110, label: 'Dashboard' },
    { x: 360, label: 'Platform API' },
    { x: 610, label: 'Phone (nexTap)' },
  ]
  const msgs: { from: number; to: number; y: number; label: string; accent?: boolean; dashed?: boolean }[] = [
    { from: 0, to: 1, y: 90, label: 'POST /applications/{id}/pairing-codes' },
    { from: 1, to: 0, y: 125, label: 'nfcp_… code + qr_payload (10 min)', dashed: true },
    { from: 0, to: 2, y: 165, label: 'shows QR → phone scans it', accent: true },
    { from: 2, to: 1, y: 205, label: 'POST /device/register  (Bearer nfcp_…)' },
    { from: 1, to: 2, y: 240, label: 'device token nfcd_… + config (code consumed)', dashed: true },
    { from: 0, to: 1, y: 280, label: 'GET /pairing-codes/{id}  (every 2 s)' },
    { from: 1, to: 0, y: 315, label: 'status: used → "Paired ✓"', dashed: true, accent: true },
  ]
  return (
    <Diagram
      h={345}
      title="QR pairing sequence"
      desc="The dashboard creates a single-use pairing code and shows it as a QR code. The phone scans it and registers with the code as its bearer credential, receiving its own device token. The dashboard polls the code status every two seconds and shows Paired when it is used."
    >
      {() => (
        <>
          {lanes.map((l) => (
            <g key={l.label}>
              <rect x={l.x - 90} y={14} width={180} height={34} rx={8} fill="var(--surface-2)" stroke="var(--border-strong)" />
              <text x={l.x} y={36} textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--fg)">
                {l.label}
              </text>
              <line x1={l.x} y1={48} x2={l.x} y2={335} stroke="var(--border-strong)" strokeDasharray="3 4" />
            </g>
          ))}
          {msgs.map((m) => {
            const x1 = lanes[m.from].x
            const x2 = lanes[m.to].x
            const dir = x2 > x1 ? 1 : -1
            return (
              <Arrow
                key={m.y}
                d={`M${x1 + dir * 4} ${m.y} H${x2 - dir * 6}`}
                label={m.label}
                lx={(x1 + x2) / 2}
                ly={m.y - 7}
                accent={m.accent}
                dashed={m.dashed}
              />
            )
          })}
        </>
      )}
    </Diagram>
  )
}

export function TapFlowDiagram() {
  return (
    <Diagram
      h={320}
      title="Business tap flow: customer phone versus reader device"
      desc="A customer's phone reads the NDEF link on a programmed card and opens the tap URL; the platform records a web tap and runs the card's action. A business reader device running nexTap reads the UID and posts an event; the platform looks up the card, records a reader tap, runs a developer webhook if configured, and returns the result shown on the phone."
    >
      {() => (
        <>
          <text x="10" y="22" fontSize="13" fontWeight="700" fill="var(--accent)">
            CUSTOMER PHONE (any phone, no app)
          </text>
          <Box x={10} y={36} w={140} title="Card / tag" sub="NDEF: tap_url" tone="muted" />
          <Box x={200} y={36} w={150} title="Phone browser" sub="opens the link" />
          <Box x={400} y={36} w={140} title="GET /t/{code}" sub="web tap recorded" tone="accent" />
          <Box x={590} y={36} w={120} title="Action" sub="302 · page · vCard" tone="ok" />
          <Arrow d="M150 64 H196" />
          <Arrow d="M350 64 H396" />
          <Arrow d="M540 64 H586" accent />
          <line x1="10" y1="120" x2="710" y2="120" stroke="var(--border)" />
          <text x="10" y="150" fontSize="13" fontWeight="700" fill="var(--accent)">
            READER DEVICE (nexTap, business)
          </text>
          <Box x={10} y={164} w={140} title="Card" sub="UID read" tone="muted" />
          <Box x={200} y={164} w={150} title="POST /device/events" sub="device token" />
          <Box x={400} y={164} w={140} title="Card lookup" sub="reader tap recorded" tone="accent" />
          <Box x={590} y={164} w={120} title="Webhook" sub="card.tapped (optional)" />
          <Arrow d="M150 192 H196" />
          <Arrow d="M350 192 H396" />
          <Arrow d="M540 192 H586" dashed />
          <Box x={200} y={250} w={340} h={54} title="Result on the phone" sub="recognized · inactive · unknown — assignee, Open action, Register" tone="ok" />
          <Arrow d="M470 220 V246" accent />
        </>
      )}
    </Diagram>
  )
}

export function ProgrammingDiagram() {
  const steps = [
    { t: 'Pick a card', s: 'Program card screen' },
    { t: 'Hold a tag', s: 'blank or rewritable' },
    { t: 'Write NDEF URI', s: 'tap_url (+ Wi-Fi record)' },
    { t: 'Report', s: 'POST …/programmed' },
    { t: 'Programmed', s: 'UID bound, never locked' },
  ]
  return (
    <Diagram
      h={120}
      title="Programming a card"
      desc="On a business reader device, pick a card, hold a writable tag, the app writes an NDEF URI record with the card's tap URL and optionally a Wi-Fi record, reports it as programmed to bind the UID, and the dashboard shows it as programmed. Tags are never made read-only."
    >
      {() => (
        <>
          {steps.map((st, i) => (
            <g key={st.t}>
              <Box x={10 + i * 142} y={30} w={124} h={60} title={st.t} sub={st.s} tone={i === 2 ? 'accent' : i === 4 ? 'ok' : 'default'} />
              {i < steps.length - 1 && <Arrow d={`M${134 + i * 142} 60 H${148 + i * 142}`} accent={i === 1} />}
            </g>
          ))}
        </>
      )}
    </Diagram>
  )
}

export function ExchangeDiagram() {
  const lanes = [
    { x: 110, label: 'A — scans' },
    { x: 360, label: 'Platform API' },
    { x: 610, label: 'B — shares' },
  ]
  const msgs: { from: number; to: number; y: number; label: string; accent?: boolean; dashed?: boolean }[] = [
    { from: 0, to: 2, y: 88, label: 'SELECT digital-card AID (NFC)' },
    { from: 2, to: 0, y: 122, label: '"NFCDC" + fresh signed token', dashed: true, accent: true },
    { from: 0, to: 1, y: 162, label: 'POST /personal/exchanges { token }' },
    { from: 1, to: 1, y: 196, label: 'verify MAC · key · issued_at' },
    { from: 1, to: 0, y: 232, label: 'contact: B’s public + contacts fields', dashed: true },
    { from: 1, to: 2, y: 268, label: 'auto-exchange on → contact for A + notification', dashed: true, accent: true },
  ]
  return (
    <Diagram
      h={300}
      title="Mutual exchange sequence"
      desc="Phone A scans phone B over NFC and receives a fresh signed token. A sends the token to the platform, which verifies it and gives A a contact with B's public and contacts fields. If B has auto-exchange on, B also receives a contact for A and a notification."
    >
      {() => (
        <>
          {lanes.map((l) => (
            <g key={l.label}>
              <rect x={l.x - 90} y={14} width={180} height={34} rx={8} fill="var(--surface-2)" stroke="var(--border-strong)" />
              <text x={l.x} y={36} textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--fg)">
                {l.label}
              </text>
              <line x1={l.x} y1={48} x2={l.x} y2={292} stroke="var(--border-strong)" strokeDasharray="3 4" />
            </g>
          ))}
          {msgs.map((m) => {
            if (m.from === m.to) {
              const x = lanes[m.from].x
              return (
                <g key={m.y}>
                  <rect x={x - 110} y={m.y - 16} width={220} height={26} rx={6} fill="var(--accent-soft)" stroke="var(--accent)" />
                  <text x={x} y={m.y + 2} textAnchor="middle" fontSize="11.5" fill="var(--fg)">
                    {m.label}
                  </text>
                </g>
              )
            }
            const x1 = lanes[m.from].x
            const x2 = lanes[m.to].x
            const dir = x2 > x1 ? 1 : -1
            return <Arrow key={m.y} d={`M${x1 + dir * 4} ${m.y} H${x2 - dir * 6}`} label={m.label} lx={(x1 + x2) / 2} ly={m.y - 7} accent={m.accent} dashed={m.dashed} />
          })}
        </>
      )}
    </Diagram>
  )
}
