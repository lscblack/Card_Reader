import { cn } from '@/lib/cn'
import { CodeBlock } from '../components/Code'
import { B, C, DocHeader, DocLink, H2, P, PrevNext, Table, UL } from '../components/Prose'
import { endpointGroups } from '../data/endpoints'
import { API_V1 } from '../samples'

const methodTone: Record<string, string> = {
  GET: 'text-emerald-500',
  POST: 'text-sky-500',
  PUT: 'text-amber-500',
  PATCH: 'text-amber-500',
  DELETE: 'text-accent',
  ANY: 'text-muted',
}

const errorEnvelope = `{
  "error": {
    "code": "invalid_api_key",
    "message": "The API key is not valid.",
    "details": null,
    "ref": "NFC-1003",
    "request_id": "3f9c…",
    "docs_url": "https://…/docs/errors#NFC-1003"
  }
}

// Validation errors: code "validation_error", details = [{ "field": "body.email", "message": "…" }]`

export default function ApiReference() {
  return (
    <article>
      <DocHeader slug="api-reference">
        <div className="mt-5 flex flex-wrap gap-2 text-[13px]">
          <span className="inline-flex max-w-full items-center truncate rounded-lg bg-surface-2 px-3 py-2 font-mono text-[12px] text-muted">{API_V1}</span>
        </div>
      </DocHeader>
      <P>
        These tables map every endpoint available to developers and business members, with the credential each one needs. Request and
        response shapes are described in the guides (for example <DocLink to="/docs/device-api">Device API</DocLink> and{' '}
        <DocLink to="/docs/webhooks">Webhooks</DocLink>). Every error returns the envelope below with a ref you can look up in{' '}
        <DocLink to="/docs/errors">Error codes</DocLink>.
      </P>

      <H2 id="conventions">Conventions</H2>
      <UL>
        <li>
          Base URL <C>{API_V1}</C>. JSON everywhere. Timestamps are ISO-8601 UTC with <C>Z</C>. IDs are UUIDv4.
        </li>
        <li>
          List endpoints take <C>page</C> (1-based) and <C>page_size</C> (default 20, max 100) and return{' '}
          <C>{'{ items, total, page, page_size }'}</C>.
        </li>
        <li>
          Every non-2xx response uses the error envelope below. Branch on HTTP status first, then <C>code</C>; quote <C>ref</C> and{' '}
          <C>request_id</C> when asking for help.
        </li>
        <li>
          Responses carry <C>X-RateLimit-Limit</C>, <C>X-RateLimit-Remaining</C> and <C>X-RateLimit-Reset</C>.
        </li>
      </UL>
      <CodeBlock language="json" title="Error envelope" code={errorEnvelope} />

      <H2 id="authentication">Authentication</H2>
      <Table
        head={['Caller', 'Header']}
        rows={[
          ['Dashboard / management API', <C key="h">Authorization: Bearer &lt;JWT&gt;</C>],
          ['Device registration', <C key="h">Authorization: Bearer nfc_… | nfcp_…</C>],
          ['Other /device/* calls', <C key="h">Authorization: Bearer nfcd_…</C>],
          ['Public endpoints', 'None'],
        ]}
      />

      {endpointGroups.map((g) => (
        <section key={g.id}>
          <H2 id={g.id}>{g.title}</H2>
          <P className="!my-2 text-[13.5px]">
            <B>Auth:</B> {g.auth}
            {g.note && <> · {g.note}</>}
          </P>
          <div className="my-4 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[600px] border-collapse text-left text-[13px]">
              <thead className="bg-surface-2">
                <tr>
                  {['Method', 'Path', 'Description'].map((h) => (
                    <th key={h} scope="col" className="border-b border-border px-3.5 py-2 text-[11.5px] font-semibold tracking-wide text-subtle uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.rows.map(([m, path, desc]) => (
                  <tr key={`${m} ${path}`} className="border-b border-border last:border-0">
                    <td className={cn('px-3.5 py-2 align-top font-mono text-[11.5px] font-bold whitespace-nowrap', methodTone[m] ?? 'text-muted')}>{m}</td>
                    <td className="px-3.5 py-2 align-top font-mono text-[12px] break-all text-fg">{path}</td>
                    <td className="px-3.5 py-2 align-top text-muted">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <PrevNext slug="api-reference" />
    </article>
  )
}
