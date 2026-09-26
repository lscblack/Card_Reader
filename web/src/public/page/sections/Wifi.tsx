import { useState } from 'react'
import { Eye, EyeOff, Wifi } from 'lucide-react'
import type { SectionDataMap } from '@/business/api/types'
import { QrCode } from '@/components/QrCode'
import { wifiPayload } from '../format'
import { CopyBtn, Sec } from '../ui'

export function WifiSection({ d }: { d: SectionDataMap['wifi'] & { title?: string } }) {
  const [show, setShow] = useState(false)
  if (!d.ssid) return null
  const open = d.security === 'nopass' || !d.password
  return (
    <Sec className="pg-wifi">
      <div className="pg-wifi-ico">
        <Wifi className="h-8 w-8" aria-hidden="true" />
      </div>
      {d.title && (
        <p className="pg-subtle" style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          {d.title}
        </p>
      )}
      <p className="pg-wifi-net pg-hf" style={{ marginTop: 4 }}>
        {d.ssid}
      </p>
      <dl className="pg-kv">
        <div>
          <dt>Network</dt>
          <dd>{d.ssid}</dd>
          <CopyBtn value={d.ssid} label="Copy network name" />
        </div>
        <div>
          <dt>Password</dt>
          {open ? (
            <dd className="pg-muted">None — open network</dd>
          ) : (
            <>
              <dd className="pg-pw" style={{ fontFamily: show ? "'JetBrains Mono', ui-monospace, monospace" : undefined, letterSpacing: show ? '0.02em' : '0.12em' }}>{show ? d.password : '•'.repeat(Math.min(10, d.password!.length))}</dd>
              <button type="button" className="pg-icon-btn" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
              <CopyBtn value={d.password!} label="Copy password" />
            </>
          )}
        </div>
        <div>
          <dt>Security</dt>
          <dd>{d.security === 'nopass' ? 'Open' : d.security === 'WEP' ? 'WEP' : 'WPA/WPA2'}</dd>
        </div>
      </dl>
      {!open && (
        <div style={{ marginTop: 12 }}>
          <CopyBtn value={d.password!} label="Copy password" text="Copy password" className="pg-btn-block" />
        </div>
      )}
      <div className="pg-qr">
        <QrCode value={wifiPayload(d.ssid, d.password, d.security, d.hidden)} size={176} label={`Wi-Fi QR code for ${d.ssid}`} />
      </div>
      <p className="pg-note" style={{ marginTop: 10 }}>
        On another phone? Point its camera at the code to join.
      </p>
    </Sec>
  )
}
