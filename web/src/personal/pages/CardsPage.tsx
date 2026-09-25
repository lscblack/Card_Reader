import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Copy, CreditCard, Eye, Handshake, Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { ConfirmDialog, Modal } from '@/components/ui/Modal'
import { Field, Input } from '@/components/ui/Input'
import { Menu } from '@/components/ui/Menu'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/toastContext'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { num } from '@/lib/format'
import { BizErrorState, FormError } from '@/business/components/BizError'
import { useErrorToast } from '@/business/hooks/useErrorToast'
import type { CardTemplate, DigitalCard } from '../api/types'
import { cardsApi } from '../api/personal'
import { usePCards, usePMutation, useTemplates } from '../hooks/queries'
import { layoutFor, renderableOf } from '../lib/card'
import { CardThumb } from '../components/DigitalCardRender'
import { TemplateGallery } from '../components/TemplateGallery'

function NewCardModal({ onClose, sample }: { onClose: () => void; sample?: DigitalCard }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [label, setLabel] = useState('')
  const [tpl, setTpl] = useState<CardTemplate | null>(null)
  const create = usePMutation(() => cardsApi.create({ label: label.trim() || 'New card', template_id: tpl?.id }))
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="New card"
      description="Start from a template — you can change everything afterwards. Details are copied from your primary card."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={create.isPending}
            disabled={!tpl}
            onClick={async () => {
              try {
                const c = await create.mutateAsync(undefined)
                toast.success('Card created')
                navigate(`/me/cards/${c.id}`)
              } catch {
                /* inline */
              }
            }}
          >
            Create card
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError error={create.error} />
        <Field label="Label" hint="Only you see it — e.g. “Work”, “Personal”, “Conference”.">
          {(p) => <Input {...p} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} placeholder="Work" data-autofocus />}
        </Field>
        <TemplateGallery value={tpl?.id} onPick={setTpl} sample={sample} />
      </div>
    </Modal>
  )
}

function CardTile({ card, onDelete }: { card: DigitalCard; onDelete: () => void }) {
  const templates = useTemplates()
  const toast = useToast()
  const onError = useErrorToast()
  const navigate = useNavigate()
  const primary = usePMutation(() => cardsApi.setPrimary(card.id))
  const dup = usePMutation(() => cardsApi.duplicate(card.id))
  return (
    <Card className="flex flex-col overflow-hidden">
      <Link to={`/me/cards/${card.id}`} className="block bg-surface-2/50 p-3" aria-label={`Edit ${card.label}`}>
        <CardThumb card={renderableOf(card)} layout={layoutFor(card.template_id, templates.data)} audience="public" qrValue={card.public_url} maxHeight={300} />
      </Link>
      <div className="flex items-start gap-2 border-t border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-[14px] font-semibold">
            {card.label}
            {card.is_primary && (
              <Badge tone="accent" className="gap-1">
                <Star className="h-3 w-3" /> Primary
              </Badge>
            )}
            {card.status === 'inactive' && <Badge tone="warning">Inactive</Badge>}
            {card.business_link && <Badge tone="info">{card.business_link.business_name}</Badge>}
          </p>
          <p className="mt-0.5 flex items-center gap-3 text-xs text-subtle">
            <span className="inline-flex items-center gap-1">
              <Eye className="h-3 w-3" /> {num(card.stats.views)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Handshake className="h-3 w-3" /> {num(card.stats.exchanges)}
            </span>
          </p>
        </div>
        <Menu
          label={`Actions for ${card.label}`}
          items={[
            { label: 'Edit', icon: <Pencil className="h-4 w-4 text-subtle" />, onSelect: () => navigate(`/me/cards/${card.id}`) },
            ...(!card.is_primary
              ? [
                  {
                    label: 'Set as primary',
                    icon: <Star className="h-4 w-4 text-subtle" />,
                    onSelect: async () => {
                      try {
                        await primary.mutateAsync(undefined)
                        toast.success(`“${card.label}” is now the card your phone shares`)
                      } catch (e) {
                        onError(e)
                      }
                    },
                  },
                ]
              : []),
            {
              label: 'Duplicate',
              icon: <Copy className="h-4 w-4 text-subtle" />,
              onSelect: async () => {
                try {
                  const d = await dup.mutateAsync(undefined)
                  toast.success('Card duplicated')
                  navigate(`/me/cards/${d.id}`)
                } catch (e) {
                  onError(e)
                }
              },
            },
            ...(!card.business_link ? [{ label: 'Delete', icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: onDelete }] : []),
          ]}
        />
      </div>
    </Card>
  )
}

export default function CardsPage() {
  useDocumentTitle('My cards')
  const { data, error, isLoading, refetch } = usePCards()
  const toast = useToast()
  const onError = useErrorToast()
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<DigitalCard | null>(null)
  const del = usePMutation((id: string) => cardsApi.remove(id))
  const primary = data?.find((c) => c.is_primary) ?? data?.[0]
  return (
    <>
      <PageHeader
        title="My cards"
        description="Keep separate cards for work, personal or events. Your phone shares the primary one."
        actions={
          <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            New card
          </Button>
        }
      />
      {error ? (
        <Card>
          <BizErrorState error={error} onRetry={() => refetch()} />
        </Card>
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-96 rounded-xl" />
          ))}
        </div>
      ) : !data?.length ? (
        <Card>
          <EmptyState
            icon={CreditCard}
            title="No cards yet"
            description="Create your first digital card to start sharing."
            action={
              <Button variant="primary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreating(true)}>
                New card
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[...data].sort((a, b) => Number(b.is_primary) - Number(a.is_primary)).map((c) => (
            <CardTile key={c.id} card={c} onDelete={() => setDeleting(c)} />
          ))}
        </div>
      )}
      {creating && <NewCardModal onClose={() => setCreating(false)} sample={primary} />}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.label}”?`}
        description="Its public link and QR codes stop working. Contacts you collected are kept."
        confirmLabel="Delete card"
        loading={del.isPending}
        onConfirm={async () => {
          try {
            await del.mutateAsync(deleting!.id)
            toast.success('Card deleted')
            setDeleting(null)
          } catch (e) {
            onError(e)
          }
        }}
      />
    </>
  )
}
