import { useState } from 'react'
import { Link } from 'react-router'
import { ExternalLink, Globe, Radio } from 'lucide-react'
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { Drawer } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { EventDetailDrawer } from '@/components/Events'
import { useNow } from '@/hooks/useNow'
import { dateTime, relativeTime } from '@/lib/format'
import type { CardTap } from '../api/types'
import { useBusiness } from '../hooks/context'
import { DEVICE_TYPE_LABEL, actionLabel, countryName } from '../lib/format'
import { ActionIcon, DetailRow, KindBadge, TapResultBadge, TapSourceBadge } from './bits'

/** Taps table (NFC Events). Rows open the detail drawer via `onOpen`. */
export function TapsTable({ taps, onOpen, showCard = true, compact = false }: { taps: CardTap[]; onOpen?: (t: CardTap) => void; showCard?: boolean; compact?: boolean }) {
  const now = useNow()
  return (
    <TableWrap>
      <Table className={compact ? 'min-w-[560px]' : 'min-w-[860px]'}>
        <THead>
          <tr>
            <TH>When</TH>
            {showCard && <TH>Card / tag</TH>}
            <TH>Holder</TH>
            <TH>Source</TH>
            <TH>Action</TH>
            <TH>Result</TH>
            {!compact && <TH>Device</TH>}
          </tr>
        </THead>
        <TBody>
          {taps.map((t) => {
            return (
              <TR
                key={t.id}
                onClick={onOpen ? () => onOpen(t) : undefined}
                tabIndex={onOpen ? 0 : undefined}
                onKeyDown={onOpen ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(t)) : undefined}
              >
                <TD className="whitespace-nowrap text-muted" title={dateTime(t.created_at, true)}>
                  {relativeTime(t.created_at, now)}
                </TD>
                {showCard && (
                  <TD className="max-w-[220px]">
                    {t.card_name ? <span className="block truncate font-medium">{t.card_name}</span> : <span className="text-subtle">Unknown card</span>}
                  </TD>
                )}
                <TD className="max-w-[180px] truncate">{t.assignee?.name ?? <span className="text-subtle">—</span>}</TD>
                <TD>
                  <TapSourceBadge source={t.source} />
                </TD>
                <TD className="whitespace-nowrap">
                  {t.action_type ? (
                    <span className="inline-flex items-center gap-1.5 text-muted">
                      <ActionIcon type={t.action_type} className="h-3.5 w-3.5 text-subtle" /> {actionLabel(t.action_type)}
                    </span>
                  ) : (
                    <span className="text-subtle">—</span>
                  )}
                </TD>
                <TD>
                  <TapResultBadge result={t.result} />
                </TD>
                {!compact && (
                  <TD className="whitespace-nowrap text-muted">
                    {t.source === 'reader' ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Radio className="h-3.5 w-3.5 text-subtle" /> {t.device_name ?? '—'}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <Globe className="h-3.5 w-3.5 text-subtle" /> {t.device_type ? DEVICE_TYPE_LABEL[t.device_type] : '—'}
                        {t.browser ? ` · ${t.browser}` : ''}
                      </span>
                    )}
                  </TD>
                )}
              </TR>
            )
          })}
        </TBody>
      </Table>
    </TableWrap>
  )
}

export function TapDetailDrawer({ tap, onClose }: { tap: CardTap | null; onClose: () => void }) {
  const { base } = useBusiness()
  const [eventId, setEventId] = useState<string | null>(null)
  return (
    <>
      <Drawer open={!!tap && !eventId} onClose={onClose} title="Tap details">
        {tap && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold">{tap.card_name ?? 'Unknown card'}</span>
              {tap.card_kind && <KindBadge kind={tap.card_kind} />}
              <TapSourceBadge source={tap.source} />
              <TapResultBadge result={tap.result} />
            </div>
            {tap.result === 'unknown_card' && (
              <p className="rounded-lg border border-border bg-surface-2 p-3 text-[13px] text-muted">
                A reader scanned a card that isn’t registered in this business. Register it from the nexTap app (if your devices are
                allowed to) or create it under NFC Cards.
              </p>
            )}
            <dl className="divide-y divide-border rounded-lg border border-border px-3">
              <DetailRow label="Time">{dateTime(tap.created_at, true)}</DetailRow>
              <DetailRow label="Card / tag">
                {tap.card_id ? (
                  <Link to={`${base}/${tap.card_kind === 'tag' ? 'tags' : 'cards'}/${tap.card_id}`} className="font-medium text-accent hover:underline">
                    {tap.card_name}
                  </Link>
                ) : (
                  '—'
                )}
              </DetailRow>
              <DetailRow label="Holder">
                {tap.assignee ? (
                  <Link to={`${base}/${tap.assignee.type === 'employee' ? 'employees' : 'customers'}/${tap.assignee.id}`} className="text-accent hover:underline">
                    {tap.assignee.name}
                  </Link>
                ) : (
                  '—'
                )}
                {tap.assignee && <Badge className="ml-2">{tap.assignee.type}</Badge>}
              </DetailRow>
              <DetailRow label="Action">{tap.action_type ? actionLabel(tap.action_type) : '—'}</DetailRow>
              <DetailRow label="Source">{tap.source === 'reader' ? 'nexTap (business device)' : 'Customer phone (web link)'}</DetailRow>
              {tap.source === 'reader' && <DetailRow label="Device">{tap.device_name ?? '—'}</DetailRow>}
              <DetailRow label="Device type">{tap.device_type ? DEVICE_TYPE_LABEL[tap.device_type] : '—'}</DetailRow>
              {tap.browser && <DetailRow label="Browser">{tap.browser}</DetailRow>}
              {tap.country && <DetailRow label="Country">{countryName(tap.country)}</DetailRow>}
              <DetailRow label="Tap ID">
                <span className="inline-flex items-center gap-1 font-mono text-[12px]">
                  <span className="truncate">{tap.id}</span> <CopyButton value={tap.id} label="Copy tap ID" />
                </span>
              </DetailRow>
            </dl>
            {tap.nfc_event_id && (
              <div className="rounded-lg border border-border p-3">
                <p className="text-[13px] font-medium">Underlying NFC event</p>
                <p className="mt-0.5 text-xs text-muted">The reader’s raw card event, with signed webhook delivery attempts (if a developer webhook ran).</p>
                <Button className="mt-2" size="sm" rightIcon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => setEventId(tap.nfc_event_id)}>
                  View event & deliveries
                </Button>
              </div>
            )}
          </div>
        )}
      </Drawer>
      <EventDetailDrawer eventId={eventId} onClose={() => setEventId(null)} />
    </>
  )
}

/** Compact list of taps for narrow cards (overview). */
export function RecentTapsList({ taps, onOpen }: { taps: CardTap[]; onOpen: (t: CardTap) => void }) {
  const now = useNow()
  return (
    <ul className="divide-y divide-border">
      {taps.map((t) => (
        <li key={t.id}>
          <button type="button" onClick={() => onOpen(t)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2/70 sm:px-5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
              <ActionIcon type={t.action_type} className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium">{t.card_name ?? 'Unknown card'}</span>
              <span className="block truncate text-xs text-subtle">
                {t.assignee?.name ?? (t.action_type ? actionLabel(t.action_type) : '—')} · {t.source === 'reader' ? (t.device_name ?? 'Reader') : t.device_type ? DEVICE_TYPE_LABEL[t.device_type] : 'Web'}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <TapSourceBadge source={t.source} />
              <span className="text-[11.5px] whitespace-nowrap text-subtle" title={dateTime(t.created_at, true)}>
                {relativeTime(t.created_at, now)}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
