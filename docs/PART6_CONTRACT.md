# Part 6 Contract — Built-in pages for actions (reusable page templates)

Extends Part 2 §B5–B6 (actions, profiles). Additive and backward compatible: existing profiles/actions keep working.

Goal: actions like **Digital menu**, **Product info**, **Offer**, **Event**, **Links**, **Wi-Fi**, **Gallery** and
**Feedback form** can be backed by a page **built inside nexTap** (no external website needed), created from
professional **page templates** (layout + theme + prefilled sections, with the business logo/colours applied), edited any
time without reprogramming cards, **duplicated**, and **saved as the business's own templates** for reuse (e.g. every
branch's menu).

## 1. Page types & sections

`Profile.type` gains: `links`, `offer`, `event`, `gallery`, `form` (existing: business, employee, custom, menu, product).
("Pages" is the UI name; the API keeps `profiles`.)

New/extended section types (all validated server-side; every URL http(s)/mailto/tel only; images must be `/media` or https):
- `menu` (extended): `{ currency, show_images, categories: [{ name, description?, items: [{ name, description?, price, image_url?,
  badges: ("vegetarian"|"vegan"|"spicy"|"gluten_free"|"new"|"popular"|"sold_out")[], variants?: [{label, price}] }] }] }`
- `products` (extended): items gain `image_url, price, compare_at_price?, badge?, cta: {label, url}?, in_stock`
- `links` `{ items: [{ label, url, icon?: platform|"link"|"phone"|"email"|"map"|"whatsapp", highlight? }] }` (link-in-bio)
- `offer` `{ title, description, code?, discount_label?, valid_until?, terms?, cta?: {label, url} }` (shows "Expired" after valid_until)
- `event` `{ title, starts_at, ends_at?, venue?, address?, map_query?, description?, cta?: {label, url} }` (+ "Add to calendar" .ics)
- `wifi` `{ ssid, password?, security: WPA|WEP|nopass, hidden? }` (copy password + Android WIFI: QR)
- `form` `{ title, description?, fields: [{ id, label, type: text|textarea|email|phone|rating|select|checkbox, required, options? }] (≤ 12),
  submit_label, success_message }`
- existing: about, contact, hours, social, services, gallery, buttons, text

`Profile.theme` extended: `{ accent, background?, surface?, text?, font?: font-pair id, layout: page layout id, header:
"cover"|"logo"|"minimal"|"banner", cover_image_url?, logo_url? (defaults to business logo), corner_radius?, dark?: bool }`.

## 2. Page templates

`PageTemplate` = `{ id, scope: "system"|"business", business_id|null, page_type, name, description, category,
preview_image_url|null, theme, sections (prefilled, with placeholders like "{{business.name}}"), created_at }`

- **System templates** (data file `backend/app/data/page_templates.json`, validated on load like card templates; invalid ones skipped
  and logged). At least 20, original designs, e.g. menus: *Bistro classic, Café chalkboard, Modern grid (photos), Fine dining,
  Bar & cocktails, Street food*; products: *Catalogue grid, Single product, Service list*; links: *Link hub, Creator*; offers:
  *Coupon, Flash sale*; events: *Event invite, Workshop*; wifi: *Guest Wi-Fi*; gallery: *Portfolio*; forms: *Feedback & rating,
  Contact request, Booking request*.
- `GET /page-templates?page_type=` (public) → system templates. `GET /businesses/{id}/page-templates?page_type=` → system +
  that business's templates.
- `POST /businesses/{id}/profiles` accepts `template_id`: creates the page from the template, replacing placeholders
  (`{{business.name}}`, `{{business.phone}}`, `{{business.email}}`, `{{business.website}}`, `{{business.address}}`) and applying
  the business logo/accent unless the template sets them.
- `POST /businesses/{id}/profiles/{pid}/duplicate` `{ title?, slug? }` → copy (unpublished).
- `POST /businesses/{id}/profiles/{pid}/save-as-template` `{ name, description? }` → business template (images kept by reference).
  `PATCH/DELETE /businesses/{id}/page-templates/{tid}` (business templates only; `profiles.manage`). Limit 50 per business.

## 3. Actions

- `digital_menu` / `product_info` already accept `profile_id`. New action types (each `{ profile_id }` of the matching page type,
  or `url` fallback where noted): `links_page`, `offer_page` (+ url), `event_page` (+ url), `feedback_form`, `gallery_page`.
  `wifi` action unchanged (config), but may instead point to a `wifi` page via `profile_id`.
- `/actions/types` describes the new types; field `profile_id` has `page_type` so the UI can offer "pick a page or create one from
  a template".

## 4. Forms & submissions

- Public: `POST /public/b/{slug}/{profile_slug}/forms/{section_id}` `{ answers: {field_id: value}, website (honeypot) }` → `201`.
  Validated against the form definition; rate limited per IP (5/10 min per page); honeypot → 201 but dropped.
- `FormResponse` = `{ id, profile_id, section_id, answers, card_id|null (if opened via a tap), created_at }`.
  `GET /businesses/{id}/form-responses?profile_id=&page=` (people.manage or profiles.manage), `DELETE …/{rid}`,
  `GET …/form-responses/export.csv` (formula-injection guarded). Notification to owners/admins on new responses.
- Rating fields feed a simple average in analytics (`GET /businesses/{id}/analytics` → `feedback: {responses, avg_rating}`).

## 5. Public rendering

The public page (`/b/{slug}/{profile_slug}`) renders each layout professionally and mobile-first, light/dark aware (respects the
theme's `dark` flag, else the viewer's system preference), with the business logo/cover, sticky category nav for menus,
search for long menus/catalogues, badges, "Add to calendar", copy coupon code, Wi-Fi QR, forms with validation and a success
state, "Powered by Nexventures" footer. `/p/*` digital cards unaffected.
