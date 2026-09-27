import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Fingerprint, Monitor, Plus, Smartphone, Trash2 } from 'lucide-react'
import { startRegistration } from '@simplewebauthn/browser'
import { authApi } from '@/api/auth'
import { ApiError } from '@/api/client'
import type { ActiveSession, Passkey } from '@/api/types'
import { useNow } from '@/hooks/useNow'
import { dateOnly, relativeTime } from '@/lib/format'
import { passkeyErrorMessage, passkeySupport } from '@/lib/passkeys'
import { Card, CardHeader } from './ui/Card'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { ConfirmDialog } from './ui/Modal'
import { ErrorState } from './ui/EmptyState'
import { SkeletonRows } from './ui/Spinner'
import { useToast } from './ui/toastContext'

const SESSIONS_KEY = ['auth', 'sessions']
const PASSKEYS_KEY = ['auth', 'passkeys']

function Row({ icon: Icon, title, meta, action }: { icon: typeof Monitor; title: ReactNode; meta: ReactNode; action?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
        <Icon className="h-4.5 w-4.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium">{title}</p>
        <p className="text-xs text-subtle">{meta}</p>
      </div>
      {action}
    </li>
  )
}

function sessionMeta(s: ActiveSession, now: number) {
  return [s.created_at && `Signed in ${dateOnly(s.created_at)}`, `last active ${relativeTime(s.last_seen_at, now)}`].filter(Boolean).join(' · ')
}

/** "Where you're signed in": this browser and the phone (one of each per account). */
export function SignedInCard() {
  const now = useNow()
  const toast = useToast()
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const sessions = useQuery({ queryKey: SESSIONS_KEY, queryFn: authApi.sessions, staleTime: 15_000 })
  const signOut = useMutation({
    mutationFn: authApi.signOutMobile,
    onSuccess: () => {
      toast.success('Phone signed out')
      setConfirm(false)
      void qc.invalidateQueries({ queryKey: SESSIONS_KEY })
      void qc.invalidateQueries({ queryKey: ['personal'] })
    },
    onError: (e) => toast.fromError(e, 'Couldn’t sign the phone out'),
  })
  const web = sessions.data?.web
  const mobile = sessions.data?.mobile

  return (
    <Card>
      <CardHeader title="Where you’re signed in" description="Each account can be signed in on one browser and one phone. Signing in somewhere new signs the previous one out." />
      {sessions.error ? (
        <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} />
      ) : sessions.isLoading ? (
        <SkeletonRows rows={2} cols={3} />
      ) : (
        <ul className="divide-y divide-border">
          <Row
            icon={Monitor}
            title={
              <>
                {web?.device_name ?? 'This browser'}
                {(web?.current ?? true) && <Badge tone="accent">This browser</Badge>}
              </>
            }
            meta={web ? sessionMeta(web, now) : 'Signed in now'}
          />
          <Row
            icon={Smartphone}
            title={mobile ? mobile.device_name : <span className="text-muted">No phone signed in</span>}
            meta={mobile ? sessionMeta(mobile, now) : 'Sign in on the nexTap app to use your phone.'}
            action={
              mobile && (
                <Button size="sm" variant="danger-soft" onClick={() => setConfirm(true)}>
                  Sign out phone
                </Button>
              )
            }
          />
        </ul>
      )}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Sign out ${mobile?.device_name ?? 'the phone'}?`}
        description="The phone is signed out right away and has to sign in again to use your account."
        confirmLabel="Sign out phone"
        loading={signOut.isPending}
        onConfirm={() => signOut.mutate()}
      />
    </Card>
  )
}

export function PasskeysCard() {
  const now = useNow()
  const toast = useToast()
  const qc = useQueryClient()
  const support = passkeySupport()
  const [adding, setAdding] = useState(false)
  const [target, setTarget] = useState<Passkey | null>(null)
  const passkeys = useQuery({ queryKey: PASSKEYS_KEY, queryFn: authApi.passkeys })
  const remove = useMutation({
    mutationFn: (id: string) => authApi.deletePasskey(id),
    onSuccess: () => {
      toast.success('Passkey removed')
      setTarget(null)
      void qc.invalidateQueries({ queryKey: PASSKEYS_KEY })
    },
    onError: (e) => toast.fromError(e, 'Couldn’t remove the passkey'),
  })

  async function add() {
    setAdding(true)
    try {
      const { challenge_id, options } = await authApi.passkeyRegisterOptions()
      const credential = await startRegistration({ optionsJSON: options })
      await authApi.passkeyRegisterVerify(challenge_id, credential)
      toast.success('You can now sign in with this passkey.', 'Passkey added')
      void qc.invalidateQueries({ queryKey: PASSKEYS_KEY })
    } catch (e) {
      if (e instanceof ApiError) toast.fromError(e, 'Couldn’t add the passkey')
      else {
        const msg = passkeyErrorMessage(e)
        if (msg) toast.error(msg, 'Couldn’t add the passkey')
      }
    } finally {
      setAdding(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Passkeys"
        description="Sign in with your fingerprint, face or screen lock instead of a password."
        actions={
          support === 'ok' && (
            <Button size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => void add()} loading={adding}>
              Add a passkey
            </Button>
          )
        }
      />
      {support !== 'ok' && (
        <p className="border-b border-border px-4 py-2.5 text-[12.5px] text-muted sm:px-5">
          {support === 'insecure' ? 'Passkeys need a secure connection (https). Open the site over https to add one.' : 'This browser doesn’t support passkeys.'}
        </p>
      )}
      {passkeys.error ? (
        <ErrorState error={passkeys.error} onRetry={() => passkeys.refetch()} />
      ) : passkeys.isLoading ? (
        <SkeletonRows rows={1} cols={3} />
      ) : !passkeys.data?.length ? (
        <p className="px-4 py-6 text-center text-[13px] text-muted sm:px-5">No passkeys yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {passkeys.data.map((p) => (
            <Row
              key={p.id}
              icon={Fingerprint}
              title={p.name}
              meta={`Added ${dateOnly(p.created_at)} · last used ${p.last_used_at ? relativeTime(p.last_used_at, now) : 'never'}`}
              action={
                <Button size="sm" variant="ghost" leftIcon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setTarget(p)}>
                  Remove
                </Button>
              }
            />
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!target}
        onClose={() => setTarget(null)}
        title={`Remove “${target?.name}”?`}
        description="You won’t be able to sign in with this passkey any more. The copy stored on your device isn’t deleted — remove it there too if you like."
        confirmLabel="Remove passkey"
        loading={remove.isPending}
        onConfirm={() => target && remove.mutate(target.id)}
      />
    </Card>
  )
}

/** Sessions + passkeys, shared by every account settings page. */
export function AccountSecurity() {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <SignedInCard />
      <PasskeysCard />
    </div>
  )
}
