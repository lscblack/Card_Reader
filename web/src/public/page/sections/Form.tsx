import { useId, useState, type FormEvent } from 'react'
import { Check, Loader2, Star } from 'lucide-react'
import type { FormField, SectionDataMap } from '@/business/api/types'
import { ApiError } from '@/api/client'
import { publicApi } from '../../api'
import { usePage } from '../ctx'
import { EMAIL_RE, PHONE_RE } from '../format'
import { Sec } from '../ui'

type Answers = Record<string, string | number | boolean>

function validate(f: FormField, v: unknown): string | null {
  const empty = v == null || v === '' || v === false
  if (empty) return f.required ? (f.type === 'rating' ? 'Please choose a rating.' : f.type === 'checkbox' ? 'Please tick this box.' : 'This field is required.') : null
  if (f.type === 'email' && !EMAIL_RE.test(String(v).trim())) return 'Enter a valid email address.'
  if (f.type === 'phone' && !PHONE_RE.test(String(v).trim())) return 'Enter a valid phone number.'
  if ((f.type === 'text' || f.type === 'email' || f.type === 'phone' || f.type === 'select') && String(v).length > 500) return 'Too long (500 characters max).'
  if (f.type === 'textarea' && String(v).length > 5000) return 'Too long (5000 characters max).'
  return null
}

function Rating({ id, value, onChange, label, invalid }: { id: string; value: number; onChange: (v: number) => void; label: string; invalid: boolean }) {
  return (
    <div className="pg-stars" role="radiogroup" aria-labelledby={id} aria-invalid={invalid || undefined}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? 's' : ''}${n === 1 ? ' — poor' : n === 5 ? ' — excellent' : ''}`}
          data-on={value >= n}
          className="pg-star"
          onClick={() => onChange(value === n ? 0 : n)}
          title={`${label}: ${n}/5`}
        >
          <Star className="h-6 w-6" fill={value >= n ? 'currentColor' : 'none'} aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}

/** A form with client-side validation mirroring the server, a honeypot and a success state. */
export function FormSection({ d, sectionId }: { d: SectionDataMap['form']; sectionId: string }) {
  const { preview, businessSlug, profileSlug } = usePage()
  const uid = useId()
  const fields = (d.fields ?? []).filter((f) => f && f.id)
  const [answers, setAnswers] = useState<Answers>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [touched, setTouched] = useState(false)
  const [hp, setHp] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle')
  const [formError, setFormError] = useState<string | null>(null)
  if (!fields.length) return null

  const set = (id: string, v: string | number | boolean) => {
    const next = { ...answers, [id]: v }
    setAnswers(next)
    if (touched) {
      const f = fields.find((x) => x.id === id)!
      setErrors((e) => ({ ...e, [id]: validate(f, v) ?? '' }))
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    setFormError(null)
    const errs: Record<string, string> = {}
    for (const f of fields) {
      const m = validate(f, answers[f.id])
      if (m) errs[f.id] = m
    }
    setErrors(errs)
    const first = Object.keys(errs)[0]
    if (first) {
      document.getElementById(`${uid}-${first}`)?.focus()
      return
    }
    if (preview) {
      setState('done')
      return
    }
    const clean: Record<string, unknown> = {}
    for (const f of fields) {
      const v = answers[f.id]
      if (v === undefined || v === '' || (f.type === 'rating' && !v)) continue
      clean[f.id] = typeof v === 'string' ? v.trim() : v
    }
    setState('sending')
    try {
      await publicApi.submitForm(businessSlug, profileSlug ?? '', sectionId, { answers: clean, website: hp })
      setState('done')
    } catch (err) {
      setState('idle')
      if (err instanceof ApiError && err.status === 429) setFormError('You’ve sent a few already — please try again in a few minutes.')
      else if (err instanceof ApiError && err.code === 'validation_error') {
        const fe: Record<string, string> = {}
        for (const [k, m] of Object.entries(err.fieldErrors)) fe[k.replace(/^answers\./, '')] = m
        setErrors(fe)
        setFormError(Object.keys(fe).some((k) => fields.some((f) => f.id === k)) ? 'Please check the highlighted fields.' : err.message)
      } else if (err instanceof ApiError && err.status === 0) setFormError('You seem to be offline. Check your connection and try again.')
      else setFormError('Something went wrong. Please try again.')
    }
  }

  if (state === 'done')
    return (
      <Sec>
        <div className="pg-success" role="status">
          <div className="pg-success-ico">
            <Check className="h-8 w-8" aria-hidden="true" />
          </div>
          <p className="pg-hf" style={{ fontSize: 22, fontWeight: 700 }}>
            {d.success_message || 'Thank you!'}
          </p>
          {preview && <p className="pg-note" style={{ marginTop: 6 }}>Preview — nothing was sent.</p>}
          <button
            type="button"
            className="pg-btn pg-btn-2"
            style={{ marginTop: 18, minHeight: 40, fontSize: 14 }}
            onClick={() => {
              setAnswers({})
              setErrors({})
              setTouched(false)
              setState('idle')
            }}
          >
            Send another response
          </button>
        </div>
      </Sec>
    )

  return (
    <Sec>
      <form className="pg-form" onSubmit={submit} noValidate aria-describedby={d.description ? `${uid}-desc` : undefined}>
        <div className="pg-form-head">
          <h2 className="pg-form-title">{d.title}</h2>
          {d.description && (
            <p id={`${uid}-desc`} className="pg-muted" style={{ marginTop: 6, fontSize: 15 }}>
              {d.description}
            </p>
          )}
        </div>
        {fields.map((f) => {
          const id = `${uid}-${f.id}`
          const err = errors[f.id]
          const v = answers[f.id]
          const common = { id, 'aria-invalid': !!err || undefined, 'aria-describedby': err ? `${id}-err` : undefined, required: f.required }
          return (
            <div key={f.id}>
              {f.type === 'checkbox' ? (
                <label className="pg-check">
                  <input type="checkbox" {...common} checked={v === true} onChange={(e) => set(f.id, e.target.checked)} />
                  <span>
                    {f.label}
                    {f.required && <span className="pg-accent"> *</span>}
                  </span>
                </label>
              ) : (
                <>
                  <label className="pg-lbl" htmlFor={f.type === 'rating' ? undefined : id} id={f.type === 'rating' ? id : undefined}>
                    {f.label}
                    {f.required ? <span className="pg-req" aria-hidden="true">*</span> : <span className="pg-subtle" style={{ fontWeight: 400, fontSize: 13 }}> (optional)</span>}
                  </label>
                  {f.type === 'textarea' ? (
                    <textarea className="pg-input" {...common} maxLength={5000} placeholder={f.placeholder} value={String(v ?? '')} onChange={(e) => set(f.id, e.target.value)} />
                  ) : f.type === 'select' ? (
                    <select className="pg-input" {...common} value={String(v ?? '')} onChange={(e) => set(f.id, e.target.value)}>
                      <option value="">Choose…</option>
                      {(f.options ?? []).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : f.type === 'rating' ? (
                    <Rating id={id} value={Number(v ?? 0)} onChange={(n) => set(f.id, n)} label={f.label} invalid={!!err} />
                  ) : (
                    <input
                      className="pg-input"
                      {...common}
                      type={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'text'}
                      inputMode={f.type === 'phone' ? 'tel' : f.type === 'email' ? 'email' : undefined}
                      autoComplete={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : /name/i.test(f.id) ? 'name' : 'off'}
                      maxLength={500}
                      placeholder={f.placeholder}
                      value={String(v ?? '')}
                      onChange={(e) => set(f.id, e.target.value)}
                    />
                  )}
                </>
              )}
              {err && (
                <p id={`${id}-err`} className="pg-err" role="alert">
                  {err}
                </p>
              )}
            </div>
          )
        })}
        <div className="pg-hp" aria-hidden="true">
          <label>
            Website
            <input type="text" name="website" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} />
          </label>
        </div>
        {formError && (
          <p className="pg-err" role="alert" style={{ marginTop: -4 }}>
            {formError}
          </p>
        )}
        <button type="submit" className="pg-btn pg-btn-block" disabled={state === 'sending'}>
          {state === 'sending' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {d.submit_label || 'Send'}
        </button>
        {preview && <p className="pg-note">Preview — responses aren’t sent from here.</p>}
      </form>
    </Sec>
  )
}
