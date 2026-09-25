import { useState, type KeyboardEvent } from 'react'
import { Globe, Plus, ShieldCheck, X } from 'lucide-react'
import type { Application } from '@/api/types'
import { ApiError, errorMessage } from '@/api/client'
import { useSetAllowedDomains } from '@/hooks/queries'
import { endpointOutsideAllowlist, MAX_ALLOWED_DOMAINS, parseAllowedDomain } from '@/lib/url'
import { Card, CardBody, CardFooter, CardHeader } from './ui/Card'
import { Input } from './ui/Input'
import { Button } from './ui/Button'
import { Alert } from './ui/Alert'
import { useToast } from './ui/toastContext'

/** Per-application endpoint domain allowlist editor (contract §7.1). */
export function AllowedDomainsCard({ app }: { app: Application }) {
  const toast = useToast()
  const save = useSetAllowedDomains(app.id)
  const saved = app.allowed_domains ?? []
  const [domains, setDomains] = useState<string[]>(saved)
  const [input, setInput] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<unknown>(null)

  const dirty = JSON.stringify(domains) !== JSON.stringify(saved)
  const outside = endpointOutsideAllowlist(app.endpoint.url, domains)
  const full = domains.length >= MAX_ALLOWED_DOMAINS

  function add() {
    // Allow pasting several entries separated by commas/whitespace.
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
      await save.mutateAsync(domains)
      toast.success(domains.length ? 'Allowed domains saved' : 'Domain restriction removed')
    } catch (e) {
      setSaveError(e)
    }
  }

  const saveErrMsg =
    saveError instanceof ApiError && saveError.code === 'endpoint_outside_allowlist'
      ? `The current endpoint (${app.endpoint.url}) would no longer be allowed. Change the endpoint URL first, or include its host in the list.`
      : saveError
        ? errorMessage(saveError)
        : null

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-accent" /> Allowed domains
          </span>
        }
        description="Optionally restrict which hosts this application's endpoint may point to. Enforced on save, before every relay delivery, and on phones in direct mode."
      />
      <CardBody className="space-y-4">
        {saveErrMsg && <Alert tone="danger">{saveErrMsg}</Alert>}
        <div
          className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-border-strong bg-surface p-1.5 focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/20"
          role="group"
          aria-label="Allowed domains"
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
            aria-label="Add a domain"
            aria-invalid={!!inputError}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              setInputError(null)
            }}
            onKeyDown={onKeyDown}
            onBlur={() => input.trim() && add()}
            placeholder={domains.length ? 'Add another…' : 'api.example.com, *.example.org, 192.168.1.74'}
            disabled={full}
            spellCheck={false}
            autoCapitalize="none"
            className="h-7 min-w-[180px] flex-1 border-0 px-1.5 font-mono text-[12.5px] shadow-none focus:ring-0"
          />
          <Button size="sm" variant="ghost" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={add} disabled={!input.trim() || full}>
            Add
          </Button>
        </div>
        {inputError ? (
          <p className="text-[12.5px] text-red-600 dark:text-red-400">{inputError}</p>
        ) : (
          <ul className="space-y-1 text-[12.5px] text-subtle">
            <li>
              <code className="text-fg">api.example.com</code> — exactly that host.
            </li>
            <li>
              <code className="text-fg">*.example.com</code> — any subdomain (<code>a.example.com</code>, <code>a.b.example.com</code>), but{' '}
              <strong className="text-fg">not</strong> <code>example.com</code> itself; add it separately if needed.
            </li>
            <li>IP literals (e.g. 192.168.1.74) for development. No scheme, port or path. Up to {MAX_ALLOWED_DOMAINS} entries; empty = no restriction.</li>
          </ul>
        )}
        {outside && (
          <Alert tone="warning">
            The current endpoint host <code className="font-mono">{outside}</code> doesn&apos;t match this list, so saving will be rejected.
            Update the endpoint URL first, or add <code className="font-mono">{outside}</code>.
          </Alert>
        )}
      </CardBody>
      <CardFooter className="justify-between">
        <p className="flex items-center gap-1.5 text-xs text-subtle">
          <Globe className="h-3.5 w-3.5" />
          {saved.length ? `${saved.length} saved ${saved.length === 1 ? 'entry' : 'entries'}` : 'No restriction'}
        </p>
        <div className="flex gap-2">
          {dirty && (
            <Button
              onClick={() => {
                setDomains(saved)
                setSaveError(null)
              }}
            >
              Reset
            </Button>
          )}
          <Button variant="primary" onClick={onSave} loading={save.isPending} disabled={!dirty || !!outside}>
            Save domains
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}
