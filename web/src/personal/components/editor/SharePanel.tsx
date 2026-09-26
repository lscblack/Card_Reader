import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Copy, RotateCcw, Star, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Switch } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/toastContext'
import { useErrorToast } from '@/business/hooks/useErrorToast'
import type { ShareSettings } from '../../api/types'
import { cardsApi } from '../../api/personal'
import { usePMutation } from '../../hooks/queries'
import { Section } from './DesignPanel'
import type { PanelProps } from './doc'

const TOGGLES: [keyof ShareSettings, string, string][] = [
  ['nfc_sharing_enabled', 'NFC sharing', 'Your phone shares this card when held near another phone or reader (primary card only).'],
  ['auto_exchange', 'Automatic exchange', 'When someone scans you, you get their card too.'],
  ['web_page_enabled', 'Public web page', 'Your link and QR code open a page with your public details. iPhones read this over NFC.'],
  ['lead_capture_enabled', 'Let visitors share back', 'Your page shows a short form so people can leave their details.'],
]

export function SharePanel({ doc, set, card, v2 }: PanelProps) {
  const navigate = useNavigate()
  const toast = useToast()
  const onError = useErrorToast()
  const [confirm, setConfirm] = useState<'rotate' | 'delete' | null>(null)
  const primary = usePMutation(() => cardsApi.setPrimary(card.id))
  const rotate = usePMutation(() => cardsApi.rotate(card.id))
  const dup = usePMutation(() => cardsApi.duplicate(card.id))
  const del = usePMutation(() => cardsApi.remove(card.id))
  const status = usePMutation((v: boolean) => cardsApi.update(card.id, { status: v ? 'active' : 'inactive' }))
  const slugBad = !/^[a-z0-9-]{3,48}$/.test(doc.slug)
  const hasBack = !!v2?.sides.includes('back')

  return (
    <div className="space-y-6">
      {hasBack && (
        <Section title="Sides">
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <span>
              <span className="block text-[13px] font-medium">Two-sided card</span>
              <span className="block text-xs text-subtle">People can flip it to see the back.</span>
            </span>
            <Switch
              checked={doc.sides_enabled.includes('back')}
              onChange={(v) => set((d) => ({ ...d, sides_enabled: v ? ['front', 'back'] : ['front'] }))}
              label="Two-sided card"
            />
          </label>
        </Section>
      )}
      <Section title="How people can get your card">
        <div className="space-y-2">
          {TOGGLES.map(([k, label, hint]) => (
            <div key={k} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
              <span>
                <span className="block text-[13px] font-medium">{label}</span>
                <span className="block text-xs text-subtle">{hint}</span>
              </span>
              <Switch checked={doc.share_settings[k]} onChange={(v) => set((d) => ({ ...d, share_settings: { ...d.share_settings, [k]: v } }))} label={label} />
            </div>
          ))}
        </div>
      </Section>
      <Section title="Public link">
        <Input aria-label="Link" value={doc.slug} onChange={(e) => set((d) => ({ ...d, slug: e.target.value.toLowerCase().replace(/\s+/g, '-') }), 'slug')} className="font-mono" maxLength={48} aria-invalid={slugBad || undefined} />
        <p className={slugBad ? 'text-[12.5px] text-red-600 dark:text-red-400' : 'text-xs text-subtle'}>{slugBad ? 'Use 3–48 lowercase letters, numbers or dashes.' : `${window.location.origin}/p/${doc.slug}`}</p>
        <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
          <span>
            <span className="block text-[13px] font-medium">Card is active</span>
            <span className="block text-xs text-subtle">When off, the link and taps show a neutral page.</span>
          </span>
          <Switch
            checked={card.status === 'active'}
            disabled={!!card.business_link}
            label="Card is active"
            onChange={(v) =>
              status
                .mutateAsync(v)
                .then(() => toast.success(v ? 'Card activated' : 'Card deactivated'))
                .catch(onError)
            }
          />
        </label>
      </Section>
      <Section title="Card actions">
        <div className="flex flex-wrap gap-2">
          {!card.is_primary && (
            <Button size="sm" leftIcon={<Star className="h-3.5 w-3.5" />} loading={primary.isPending} onClick={() => primary.mutateAsync(undefined).then(() => toast.success('This is now the card your phone shares')).catch(onError)}>
              Set as primary
            </Button>
          )}
          <Button size="sm" leftIcon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setConfirm('rotate')}>
            Rotate codes
          </Button>
          <Button
            size="sm"
            leftIcon={<Copy className="h-3.5 w-3.5" />}
            loading={dup.isPending}
            onClick={() =>
              dup
                .mutateAsync(undefined)
                .then((d) => {
                  toast.success('Card duplicated')
                  navigate(`/me/cards/${d.id}`)
                })
                .catch(onError)
            }
          >
            Duplicate
          </Button>
          {!card.business_link && (
            <Button size="sm" variant="danger-soft" leftIcon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setConfirm('delete')}>
              Delete
            </Button>
          )}
        </div>
      </Section>
      <ConfirmDialog
        open={confirm === 'rotate'}
        onClose={() => setConfirm(null)}
        title="Rotate your codes?"
        description="Old QR codes, exchange codes and NFC tokens for this card stop working immediately. Your public link stays the same."
        confirmLabel="Rotate"
        loading={rotate.isPending}
        onConfirm={() =>
          rotate
            .mutateAsync(undefined)
            .then(() => {
              toast.success('Codes rotated')
              setConfirm(null)
            })
            .catch(onError)
        }
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        title={`Delete “${card.label}”?`}
        description="Its public link and QR codes stop working. Contacts you collected are kept."
        confirmLabel="Delete card"
        loading={del.isPending}
        onConfirm={() =>
          del
            .mutateAsync(undefined)
            .then(() => {
              toast.success('Card deleted')
              navigate('/me/cards', { replace: true })
            })
            .catch(onError)
        }
      />
    </div>
  )
}
