/**
 * DEV-ONLY sample of `GET /errors` used by the mock API (src/api/mock/server.ts) so the docs can be demoed
 * without the backend. The real catalog is served by the backend and is the source of truth.
 */
export interface MockCatalogEntry {
  code: string
  ref: string
  http_status: number | null
  source: 'api' | 'delivery' | 'mobile'
  title: string
  description: string
  fix: string
}

const e = (
  ref: string,
  code: string,
  http_status: number | null,
  source: MockCatalogEntry['source'],
  title: string,
  description: string,
  fix: string,
): MockCatalogEntry => ({ ref, code, http_status, source, title, description, fix })

export const mockErrorCatalog: MockCatalogEntry[] = [
  e('NFC-1001', 'not_authenticated', 401, 'api', 'Not authenticated', 'The request has no valid Authorization header.', 'Send Authorization: Bearer <token> with a valid credential.'),
  e('NFC-1002', 'invalid_credentials', 401, 'api', 'Invalid email or password', 'The email and password do not match an account.', 'Check the credentials or reset your password.'),
  e('NFC-1003', 'invalid_api_key', 401, 'api', 'Invalid API key', 'The API key used to register a device is unknown.', 'Copy the key again (it starts with nfc_) or create a new one under API keys. Prefer QR pairing.'),
  e('NFC-1004', 'api_key_revoked', 401, 'api', 'API key revoked', 'The API key was revoked and can no longer register devices.', 'Create a new API key for the application.'),
  e('NFC-1005', 'invalid_device_token', 401, 'api', 'Invalid device token', 'The device token is unknown.', 'Register the device again.'),
  e('NFC-1006', 'device_revoked', 401, 'api', 'Device revoked', 'The device was revoked from the dashboard.', 'Wipe the stored token and register the device again.'),
  e('NFC-1007', 'invalid_pairing_code', 401, 'api', 'Invalid pairing code', 'The pairing code is unknown, already used, expired or cancelled.', 'Generate a new QR code in the dashboard; codes expire after 10 minutes.'),
  e('NFC-1008', 'token_expired', 401, 'api', 'Session expired', 'The dashboard session has expired.', 'Sign in again.'),
  e('NFC-1010', 'account_disabled', 403, 'api', 'Account disabled', 'An administrator deactivated this account.', 'Contact the platform administrator.'),
  e('NFC-2001', 'validation_error', 422, 'api', 'Validation failed', 'One or more fields are invalid; details lists { field, message }.', 'Fix the fields listed in details and retry.'),
  e('NFC-2004', 'not_found', 404, 'api', 'Not found', "The resource doesn't exist or isn't yours.", 'Check the ID and that you are using the right account.'),
  e('NFC-2005', 'method_not_allowed', 405, 'api', 'Method not allowed', 'The HTTP method is not supported on this route.', 'Check the API reference for the allowed methods.'),
  e('NFC-2029', 'rate_limited', 429, 'api', 'Too many requests', 'The rate limit for this client was exceeded.', 'Wait for Retry-After seconds, then retry with backoff.'),
  e('NFC-3001', 'application_disabled', 403, 'api', 'Application paused', 'The application is paused (is_active = false).', 'Resume the application; devices keep their token and retry.'),
  e('NFC-3010', 'domain_not_allowed', 422, 'api', 'Domain not allowed', "The endpoint host is not in the application's allowlist.", 'Add the host to Allowed domains or use an allowed endpoint.'),
  e('NFC-3011', 'endpoint_outside_allowlist', 409, 'api', 'Endpoint outside allowlist', 'The new allowlist would exclude the current endpoint.', 'Change the endpoint first, then the allowlist.'),
  e('NFC-4001', 'event_id_conflict', 409, 'api', 'Event ID already used', 'The event_id was already used by another device.', 'Generate a new UUID for each tap.'),
  e('NFC-4002', 'invalid_card_id', 422, 'api', 'Invalid card ID', 'card_id must be 4–64 hex characters after normalisation.', 'Send the UID as hex; separators are stripped.'),
  e('NFC-5001', 'delivery_timeout', null, 'delivery', 'Endpoint timed out', 'Your endpoint did not respond within the configured timeout.', 'Respond faster (do heavy work asynchronously) or raise the timeout (max 30 s).'),
  e('NFC-5002', 'delivery_connection_refused', null, 'delivery', 'Connection refused', 'Nothing accepted the connection at the endpoint host and port.', 'Check the server is running and reachable from the internet.'),
  e('NFC-5003', 'delivery_dns_failure', null, 'delivery', 'DNS lookup failed', "The endpoint host name couldn't be resolved.", 'Check the host name and DNS records.'),
  e('NFC-5004', 'delivery_tls_error', null, 'delivery', 'TLS error', 'The TLS handshake failed (invalid or expired certificate).', 'Install a valid certificate for the endpoint host.'),
  e('NFC-5005', 'delivery_http_4xx', null, 'delivery', 'Endpoint returned 4xx', 'Your endpoint rejected the request.', 'Check your signature verification and logs; a 401 often means the wrong secret.'),
  e('NFC-5006', 'delivery_http_5xx', null, 'delivery', 'Endpoint returned 5xx', 'Your endpoint failed while handling the request.', 'Check your server logs; relay retries automatically.'),
  e('NFC-5007', 'delivery_redirect_blocked', null, 'delivery', 'Redirect not followed', 'Your endpoint answered with a redirect; redirects are never followed.', 'Configure the final URL as the endpoint.'),
  e('NFC-5008', 'delivery_ssrf_blocked', null, 'delivery', 'Private address blocked', 'The endpoint resolved to a private, loopback or metadata address.', 'Use a public HTTPS endpoint.'),
  e('NFC-6003', 'insufficient_permissions', 403, 'api', 'Insufficient permissions', 'Your business role lacks the permission in details.required.', 'Ask an owner or admin for the permission.'),
  e('NFC-6010', 'invalid_action_config', 422, 'api', 'Invalid action configuration', "The tap action's config is missing or invalid fields.", 'Fix the fields listed in details.'),
  e('NFC-6011', 'card_uid_exists', 409, 'api', 'Card UID already registered', 'Another card in this business already has this UID.', 'Use a different card or edit the existing one.'),
  e('NFC-7001', 'plan_limit_reached', 402, 'api', 'Plan limit reached', 'A plan limit (details.limit) was reached.', 'Upgrade your plan or free up capacity.'),
  e('NFC-8001', 'sandbox_body_too_large', 413, 'api', 'Sandbox body too large', 'Requests to a sandbox endpoint are limited to 64 KB.', 'Send a smaller body.'),
  e('NFC-9000', 'internal_error', 500, 'api', 'Internal error', 'Something went wrong on our side.', 'Retry later and quote the request_id if it persists.'),
  e('MOB-1001', 'nfc_unavailable', null, 'mobile', 'NFC not available', "This phone has no NFC hardware, or it's an emulator.", 'Use a physical Android phone with NFC.'),
  e('MOB-1002', 'nfc_disabled', null, 'mobile', 'NFC is off', 'NFC is turned off in Android settings.', 'Turn NFC on; the app links you to the setting.'),
  e('MOB-1003', 'offline', null, 'mobile', 'Phone offline', 'The phone has no network connection.', 'Events are queued and sent when the connection returns.'),
  e('MOB-1004', 'tls_failure', null, 'mobile', 'Secure connection failed', 'The phone could not establish HTTPS to the server or endpoint.', 'Check the server certificate and the phone date/time.'),
]
