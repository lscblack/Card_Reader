import { API_BASE_URL, API_PREFIX } from '@/api/client'
import type { Sample } from './components/Code'

export const API_V1 = `${API_BASE_URL}${API_PREFIX}`

export interface RequestSpec {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Path under /api/v1 (or from the server root when `root` is true). May include a query string. */
  path: string
  /** Bearer credential placeholder, e.g. "nfc_YOUR_API_KEY". */
  auth?: string
  body?: unknown
  headers?: Record<string, string>
  root?: boolean
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

function pyLiteral(v: Json, indent = 0): string {
  const pad = '    '.repeat(indent + 1)
  const end = '    '.repeat(indent)
  if (v === null) return 'None'
  if (v === true) return 'True'
  if (v === false) return 'False'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') return JSON.stringify(v)
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x !== 'object' || x === null)) return `[${v.map((x) => pyLiteral(x)).join(', ')}]`
    return `[\n${v.map((x) => pad + pyLiteral(x, indent + 1)).join(',\n')},\n${end}]`
  }
  const entries = Object.entries(v)
  if (entries.length === 0) return '{}'
  return `{\n${entries.map(([k, x]) => `${pad}${JSON.stringify(k)}: ${pyLiteral(x, indent + 1)}`).join(',\n')},\n${end}}`
}

export function requestSamples(r: RequestSpec): Sample[] {
  const url = `${r.root ? API_BASE_URL : API_V1}${r.path}`
  const headers: Record<string, string> = { ...(r.auth ? { Authorization: `Bearer ${r.auth}` } : {}), ...r.headers }
  const hasBody = r.body !== undefined
  if (hasBody) headers['Content-Type'] = 'application/json'
  const json = hasBody ? JSON.stringify(r.body, null, 2) : ''
  const lower = r.method.toLowerCase()

  // curl
  const curlLines = [`curl -X ${r.method} "${url}"`]
  for (const [k, v] of Object.entries(headers)) curlLines.push(`  -H "${k}: ${v}"`)
  if (hasBody) curlLines.push(`  -d '${json.replace(/\n/g, '\n  ')}'`)
  const curl = curlLines.join(' \\\n')

  // Python (requests)
  const pyHeaders = Object.entries(headers).filter(([k]) => k !== 'Content-Type')
  const pyArgs = [`    "${url}"`]
  if (pyHeaders.length) pyArgs.push(`    headers=${pyLiteral(Object.fromEntries(pyHeaders), 1)}`)
  if (hasBody) pyArgs.push(`    json=${pyLiteral(r.body as Json, 1)}`)
  pyArgs.push('    timeout=10')
  const python = `import requests\n\nresp = requests.${lower}(\n${pyArgs.join(',\n')},\n)\nprint(resp.status_code, resp.text)`

  // Node.js (fetch, 18+)
  const nodeOpts = [`  method: "${r.method}"`]
  if (Object.keys(headers).length) nodeOpts.push(`  headers: ${JSON.stringify(headers, null, 2).replace(/\n/g, '\n  ')}`)
  if (hasBody) nodeOpts.push(`  body: JSON.stringify(${json.replace(/\n/g, '\n  ')})`)
  const node = `// Node.js 18+ (built-in fetch)\nconst res = await fetch("${url}", {\n${nodeOpts.join(',\n')},\n});\nconsole.log(res.status, await res.text());`

  // PHP (ext-curl)
  const phpHeaders = Object.entries(headers).map(([k, v]) => `        '${k}: ${v}',`)
  const php = [
    '<?php',
    ...(hasBody ? [`$body = <<<'JSON'`, json, 'JSON;', ''] : []),
    `$ch = curl_init('${url}');`,
    'curl_setopt_array($ch, [',
    `    CURLOPT_CUSTOMREQUEST  => '${r.method}',`,
    '    CURLOPT_RETURNTRANSFER => true,',
    ...(phpHeaders.length ? ['    CURLOPT_HTTPHEADER     => [', ...phpHeaders, '    ],'] : []),
    ...(hasBody ? ['    CURLOPT_POSTFIELDS     => $body,'] : []),
    ']);',
    '$response = curl_exec($ch);',
    'echo curl_getinfo($ch, CURLINFO_HTTP_CODE), PHP_EOL, $response;',
  ].join('\n')

  const indent = (text: string, pad: string) => text.split('\n').map((l) => pad + l).join('\n')
  const hdrs = Object.entries(headers)
  const authValue = r.auth ? r.auth : null

  // Go (net/http)
  const go = [
    'package main',
    '',
    'import (',
    '\t"fmt"',
    '\t"io"',
    '\t"net/http"',
    ...(hasBody ? ['\t"strings"'] : []),
    ')',
    '',
    'func main() {',
    ...(hasBody ? ['\tbody := strings.NewReader(`' + json + '`)'] : []),
    '\treq, err := http.NewRequest("' + r.method + '", "' + url + '", ' + (hasBody ? 'body' : 'nil') + ')',
    '\tif err != nil {',
    '\t\tpanic(err)',
    '\t}',
    ...hdrs.map(([k, v]) => '\treq.Header.Set("' + k + '", "' + v + '")'),
    '\tres, err := http.DefaultClient.Do(req)',
    '\tif err != nil {',
    '\t\tpanic(err)',
    '\t}',
    '\tdefer res.Body.Close()',
    '\tout, _ := io.ReadAll(res.Body)',
    '\tfmt.Println(res.StatusCode, string(out))',
    '}',
  ].join('\n')

  // Java 17+ (java.net.http)
  const java = [
    'import java.net.URI;',
    'import java.net.http.HttpClient;',
    'import java.net.http.HttpRequest;',
    'import java.net.http.HttpResponse;',
    '',
    'public class Example {',
    '  public static void main(String[] args) throws Exception {',
    ...(hasBody ? ['    var body = """', indent(json, '        '), '        """;'] : []),
    '    var req = HttpRequest.newBuilder(URI.create("' + url + '"))',
    ...hdrs.map(([k, v]) => '        .header("' + k + '", "' + v + '")'),
    '        .method("' + r.method + '", ' + (hasBody ? 'HttpRequest.BodyPublishers.ofString(body)' : 'HttpRequest.BodyPublishers.noBody()') + ')',
    '        .build();',
    '    var res = HttpClient.newHttpClient().send(req, HttpResponse.BodyHandlers.ofString());',
    '    System.out.println(res.statusCode() + " " + res.body());',
    '  }',
    '}',
  ].join('\n')

  // C# (.NET 8, top-level statements)
  const csharp = [
    'using System.Net.Http.Headers;',
    'using System.Text;',
    '',
    'using var http = new HttpClient();',
    'var req = new HttpRequestMessage(new HttpMethod("' + r.method + '"), "' + url + '");',
    ...(authValue ? ['req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", "' + authValue + '");'] : []),
    ...hdrs.filter(([k]) => k !== 'Authorization' && k !== 'Content-Type').map(([k, v]) => 'req.Headers.Add("' + k + '", "' + v + '");'),
    ...(hasBody ? ['req.Content = new StringContent("""', indent(json, '    '), '    """, Encoding.UTF8, "application/json");'] : []),
    'var res = await http.SendAsync(req);',
    'Console.WriteLine((int)res.StatusCode + " " + await res.Content.ReadAsStringAsync());',
  ].join('\n')

  // Ruby (net/http)
  const rubyClass = r.method.charAt(0) + r.method.slice(1).toLowerCase()
  const ruby = [
    'require "net/http"',
    '',
    'uri = URI("' + url + '")',
    'req = Net::HTTP::' + rubyClass + '.new(uri)',
    ...hdrs.map(([k, v]) => 'req["' + k + '"] = "' + v + '"'),
    ...(hasBody ? ['req.body = <<~JSON', indent(json, '  '), 'JSON'] : []),
    'res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == "https") { |http| http.request(req) }',
    'puts res.code, res.body',
  ].join('\n')

  // Rust (reqwest, blocking)
  const rust = [
    '// Cargo.toml: reqwest = { version = "0.12", features = ["blocking"] }',
    'fn main() -> Result<(), Box<dyn std::error::Error>> {',
    ...(hasBody ? ['    let body = r#"' + json.replace(/\n/g, '\n    ') + '"#;'] : []),
    '    let res = reqwest::blocking::Client::new()',
    '        .request(reqwest::Method::' + r.method + ', "' + url + '")',
    ...hdrs.map(([k, v]) => '        .header("' + k + '", "' + v + '")'),
    ...(hasBody ? ['        .body(body)'] : []),
    '        .send()?;',
    '    println!("{} {}", res.status(), res.text()?);',
    '    Ok(())',
    '}',
  ].join('\n')

  // Kotlin (JVM, java.net.http)
  const kotlin = [
    'import java.net.URI',
    'import java.net.http.HttpClient',
    'import java.net.http.HttpRequest',
    'import java.net.http.HttpResponse',
    '',
    'fun main() {',
    ...(hasBody ? ['    val body = """', indent(json, '        '), '    """.trimIndent()'] : []),
    '    val req = HttpRequest.newBuilder(URI.create("' + url + '"))',
    ...hdrs.map(([k, v]) => '        .header("' + k + '", "' + v + '")'),
    '        .method("' + r.method + '", ' + (hasBody ? 'HttpRequest.BodyPublishers.ofString(body)' : 'HttpRequest.BodyPublishers.noBody()') + ')',
    '        .build()',
    '    val res = HttpClient.newHttpClient().send(req, HttpResponse.BodyHandlers.ofString())',
    '    println(res.statusCode().toString() + " " + res.body())',
    '}',
  ].join('\n')

  return [
    { label: 'curl', language: 'bash', code: curl },
    { label: 'Python', language: 'python', code: python },
    { label: 'Node.js', language: 'javascript', code: node },
    { label: 'PHP', language: 'php', code: php },
    { label: 'Go', language: 'go', code: go },
    { label: 'Java', language: 'java', code: java },
    { label: 'C#', language: 'csharp', code: csharp },
    { label: 'Ruby', language: 'ruby', code: ruby },
    { label: 'Rust', language: 'rust', code: rust },
    { label: 'Kotlin', language: 'kotlin', code: kotlin },
  ]
}
