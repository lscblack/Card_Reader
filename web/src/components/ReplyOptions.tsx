import { useState, type KeyboardEvent } from 'react'
import { MapPin, Plus, X } from 'lucide-react'
import type { Application } from '@/api/types'
import { errorMessage } from '@/api/client'
import { useSetReplyOptions } from '@/hooks/queries'
import { MAX_ALLOWED_DOMAINS, parseAllowedDomain } from '@/lib/url'
import { Card, CardBody, CardFooter, CardHeader } from './ui/Card'
import { Input, Switch } from './ui/Input'
import { Button } from './ui/Button'
import { Alert } from './ui/Alert'
import { useToast } from './ui/toastContext'

/** Per-application opt-ins for what a phone does with the endpoint's reply: open links, share location. */
export function ReplyOptionsCard({ app }: { app: Application }) {
  const toast = useToast()
  const save = useSetReplyOptions(app.id)
  const savedDomains = app.link_domains ?? []
  const savedShare = app.share_location ?? false
  const [domains, setDomains] = useState<string[]>(savedDomains)
  const [share, setShare] = useState(savedShare)
  const [input, setInput] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<unknown>(null)

  const dirty = JSON.stringify(domains) !== JSON.stringify(savedDomains) || share !== savedShare
  const full = domains.length >= MAX_ALLOWED_DOMAINS

  function add() {
    const parts = input.split(/[\s,]+/).filter(Boolean)
    if (!parts.length) return
    const next = [...domains]
    for (const p of parts) {
      const r = parseAllowedDomain(p)
      if (r.error) return setInputError(`${p}: ${r.error}`)
      if (next.includes(r.value!)) continue
      if (next.length >= MAX_ALLOWED_DOMAINS) return setInputError(`At most ${MAX_ALLOWED_DOMAINS} entries per application.`)
      next.push(r.value!)
    }
    setDomains(next)
    setInput('')
    setInputError(null)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add()
    } else if (e.key === 'Backspace' && !input && domains.length) {
      setDomains(domains.slice(0, -1))
    }
  }

  async function onSave() {
    setSaveError(null)
    try {
      await save.mutateAsync({ link_domains: domains, share_location: share })
      toast.success('Reply options saved')
    } catch (e) {
      setSaveError(e)
    }
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-accent" /> Phone reply &amp; location
          </span>
        }
        description="What the reader phone may do with your endpoint's reply. Both are off by default. The phone always shows a reply's display text."
      />
      <CardBody className="space-y-5">
        {saveError ? <Alert tone="danger">{errorMessage(saveError)}</Alert> : null}
        <div className="space-y-2">
          <p className="text-sm font-medium">Link domains</p>
          <p className="text-[12.5px] text-subtle">
            When the reply contains <code className="text-fg">action_url</code>, the phone opens it only if it is https and its host is in this list. Empty = never
            open a returned link. Same entry format as above (<code>app.example.com</code> exact, <code>*.example.com</code> subdomains).
          </p>
          <div
            className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-border-strong bg-surface p-1.5 focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/20"
            role="group"
            aria-label="Link domains"
          >
            {domains.map((d) => (
              <span key={d} className="inline-flex items-center gap-1 rounded-md bg-surface-2 py-0.5 pr-0.5 pl-2 font-mono text-[12.5px] ring-1 ring-border">
                {d}
                <button
                  type="button"
                  onClick={() => setDomains(domains.filter((x) => x !== d))}
                  className="inline-flex h-5 w-5 items-center justify-center rounded text-subtle hover:bg-surface-3 hover:text-fg"
                  aria-label={`Remove ${d}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <Input
              aria-label="Add a link domain"
              aria-invalid={!!inputError}
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                setInputError(null)
              }}
              onKeyDown={onKeyDown}
              onBlur={() => input.trim() && add()}
              placeholder={domains.length ? 'Add another…' : 'app.example.com'}
              disabled={full}
              spellCheck={false}
              autoCapitalize="none"
              className="h-7 min-w-[180px] flex-1 border-0 px-1.5 font-mono text-[12.5px] shadow-none focus:ring-0"
            />
            <Button size="sm" variant="ghost" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={add} disabled={!input.trim() || full}>
              Add
            </Button>
          </div>
          {inputError ? <p className="text-[12.5px] text-red-600 dark:text-red-400">{inputError}</p> : null}
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Share location</p>
            <p className="text-[12.5px] text-subtle">
              The phone sends its location with every tap (<code>location</code> in the signed body). While your reply says{' '}
              <code className="text-fg">session_open: true</code> it also sends <code>location.update</code> events in the background, with a visible indicator, and stops
              when the reply says <code>false</code> or this is turned off. The phone asks the user for permission.
            </p>
          </div>
          <Switch checked={share} onChange={setShare} label="Share location" />
        </div>
      </CardBody>
      <CardFooter className="justify-end gap-2">
        {dirty && (
          <Button
            onClick={() => {
              setDomains(savedDomains)
              setShare(savedShare)
              setSaveError(null)
            }}
          >
            Reset
          </Button>
        )}
        <Button variant="primary" onClick={onSave} loading={save.isPending} disabled={!dirty}>
          Save
        </Button>
      </CardFooter>
    </Card>
  )
}
