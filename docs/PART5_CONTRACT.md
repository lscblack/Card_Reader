# Part 5 Contract — Card Design v2 (shape templates, front/back, drag-and-drop arrangement, ID badges)

Extends Part 4 (`PART4_CONTRACT.md`). Fully additive: existing cards (design v1: `template.layout` + `design`)
keep rendering exactly as today. Same conventions as before (error envelope/refs, audit, no secrets in logs).

Product decisions (confirmed):
- Arrangement is **blocks & zones** (drag blocks to reorder and move them between a template's zones) — no free canvas.
- Cards can be **front + back** (flip animation) or single-sided.
- ID-badge templates support **QR code**, **barcode (Code 128)**, and **business-issued badges** (company branding,
  locked fields). No arbitrary custom label/value rows.
- Templates are **original designs inspired by** common business-card/ID-badge styles (diagonal bands, waves,
  origami folds, corner bands, curve split, geometric split, vertical badges). Never copy stock artwork or watermarked
  designs; no stock photos are bundled.

## 1. Template v2 format (served by the backend, rendered generically by web + mobile)

`GET /personal/templates` (public) returns v1 and v2 templates; v2 entries have `engine: "v2"` and:

```json
{
  "id": "diagonal_crimson", "engine": "v2", "name": "Diagonal Crimson", "category": "business" | "badge" | "minimal",
  "description": "…", "premium": false,
  "format": "landscape" | "portrait",          // landscape = 1750×1000 units (1.75:1), portrait = 1000×1586 (CR80 badge)
  "sides": ["front", "back"],                   // or ["front"]
  "default_design": { "primary": "#C8102E", "secondary": "#1F2937", "background": "#FFFFFF", "text": "#111827",
                      "accent": "#C8102E", "font": "sans", "photo_shape": "circle", "photo_ring": true,
                      "icon_style": "filled", "decor_style": null, "background_image_opacity": 0.0 },
  "canvas": {
    "front": {
      "background": "background",                                 // colour token or #hex
      "layers": [                                                 // drawn in order, clipped to the rounded card
        { "path": "M0 0 H1750 V380 L0 620 Z", "fill": "primary", "opacity": 1 },
        { "path": "…", "fill": "secondary", "opacity": 0.9 },
        { "path": "…", "fill": "image", "opacity": 0.35 }        // "image" = the card's cover/background image, if any
      ],
      "zones": [
        { "id": "hero", "rect": [80, 90, 700, 820], "align": "start"|"center"|"end", "valign": "start"|"center"|"end",
          "on": "primary"|"secondary"|"background"|"text"|"#hex",   // token of what's underneath → text colour picks contrast
          "accepts": ["photo","name","logo","company","tagline","qr","contacts","socials","website","address","bio","badge_meta","barcode"],
          "max_blocks": 4 }
      ]
    },
    "back": { … same shape … }
  },
  "default_arrangement": { "front": { "hero": ["photo", "name"], "info": ["contacts"] }, "back": { "brand": ["logo", "company", "qr"] } }
}
```

- Optional `variants: [{ id, name, canvas: { front?: { layers }, back?: { layers } } }]` — alternative decor for the same
  zones; `design.decor_style` selects one by id (layers of that side are replaced, zones unchanged; unknown id → default).
- Font values: `design.font` is a font-pair id from `/personal/design-presets` (`sans, display, geometric, elegant, serif,
  humanist, condensed, mono`) or a v1 font key; unknown → `sans`.
- `path` uses absolute SVG path syntax (`M L H V C Q A Z`) in the side's unit coordinates (landscape 1750×1000,
  portrait 1000×1586). Colour tokens: `primary, secondary, background, text, accent, image`, or `#RRGGBB`.
- Zone `rect` = `[x, y, w, h]` in the same units. Blocks in a zone stack vertically (gap scales with card size) and
  shrink text to fit; overflow is clipped with ellipsis, never spilling out of the zone.
- Text colour inside a zone: `design.text` if the zone's `on` token is light enough, otherwise white/near-white
  (WCAG contrast ≥ 4.5:1 against the `on` colour) — same algorithm on web and mobile.
- **Blocks** (each at most once per card): `photo` (shape from `design.photo_shape`: circle|rounded|square|hexagon,
  optional ring in accent), `name` (full_name + headline/job_title), `company` (company + department), `logo`,
  `tagline` (headline), `contacts` (phones + emails, icon rows), `website`, `address`, `socials` (icon row), `bio`,
  `qr` (public URL QR), `barcode` (Code 128 of `fields.barcode_value`), `badge_meta` (ID No / valid until / issued rows).
  Icon rows use `design.icon_style`: filled (accent circle), outline, none.
- Visibility still applies per field (a block whose fields are all hidden for the viewer renders nothing).

**Seed at least 16 v2 templates** (original designs): landscape — `diagonal_crimson` (diagonal red band + round photo +
navy accent), `gold_wave` (navy/gold flowing wave, front brand + back details), `skyline_split` (angled red ribbons,
right panel uses the card's cover image or a pattern), `origami_gold` (black/gold folded blocks), `corner_flare`
(dark card with red corner bands), `night_wave` (charcoal + red wave, QR on back), `ocean_curve` (blue gradient curve
split + QR), `teal_geometric` (white/teal angled split), `minimal_line`, `mono_bold`; portrait badges —
`badge_wave` (header wave + round photo), `badge_header` (colour header + square photo + barcode), `badge_arc`,
`badge_stripes` (diagonal stripe accents), `badge_hex` (hexagon photo frame), `badge_classic` (clean white + QR).
Defaults in the dark-red platform palette; other colourways come from design presets (§3).

## 2. Card fields & arrangement (DigitalCard additions)

`DigitalCard` gains:
- `design_version: 1 | 2` (2 when the template is v2)
- `sides_enabled: ["front"] | ["front","back"]` (subset of the template's sides)
- `arrangement: { "front": { zoneId: blockId[] }, "back": { … } }` — validated against the template: known zones,
  blocks accepted by the zone, `max_blocks`, each block at most once overall → `422 invalid_arrangement` with details.
  Missing → template default.
- `design` additions: `secondary`, `photo_shape`, `photo_ring`, `icon_style`, `decor_style` (optional variant id of
  the template), `background_image_opacity` (0–0.8); `cover_url` doubles as the background image for `image` layers.
- `fields` additions: `id_number`, `valid_from`, `valid_until` (ISO date), `barcode_value` (≤ 48 chars, Code-128
  printable ASCII) — each with visibility (defaults `contacts` for id_number/barcode, `public` for valid_until).
- `PATCH /personal/cards/{id}` accepts all of the above; switching template keeps field values and maps the old
  arrangement onto the new template's zones best-effort (same block → first zone that accepts it).

## 3. Design helpers (server data, used by both editors)

- `GET /personal/design-presets` (public) → `{ palettes: [{id, name, primary, secondary, background, text, accent}] (≥ 16, incl. crimson/navy, gold/black, teal, ocean, forest, sunset, mono, pastel…), font_pairs: [{id, heading, body, style}] }`.
- Colour extraction from the logo/photo is done client-side (dominant colours → suggested palette).

## 4. Business-issued ID badges

- `POST /businesses/{id}/employees/{eid}/digital-card` accepts `template_id` (v2 badge templates allowed),
  `design`, `arrangement`, `badge: { id_number?, valid_from?, valid_until?, barcode_value? }` and `locked_fields`
  (defaults for badges: `company, id_number, valid_until, barcode_value`). `Employee` gains `employee_number` (optional,
  unique per business) used as the default `id_number` and `barcode_value`.
- Expired badges (`valid_until` < today) render an "Expired" ribbon; readers get `digital_card.expired: true`.

## 5. Clients

**Renderer (web `DigitalCardRender` v2 + Flutter equivalent):** draws layers (SVG paths), zones and blocks per §1,
front/back with a 3D flip (tap/click or button; respects reduced motion), identical output on web and mobile
(same maths for scaling, text fitting and contrast), thumbnail mode, print-ish crisp at any size.

**Editor (web + mobile), redesigned:** template gallery with category tabs (Business, ID badge, Minimal) and live
thumbnails of the user's own data; canvas preview with front/back toggle + flip, zoom, and a "view as public/contact"
switch; **Arrange** panel: drag-and-drop blocks between zones and reorder within a zone (keyboard accessible:
pick up/move/drop with keys), hidden-blocks tray, reset to template default; **Design** panel: palettes, colour pickers
with contrast warnings, "extract colours from logo/photo", font pairs, photo shape + ring, icon style, background image
+ opacity, template variants; **Content** panel: fields + visibility (incl. badge fields); undo/redo; autosave with
status; "Surprise me" (random palette/variant).

**Mobile app visual refresh:** match the web design language (typography scale, spacing, cards, dark-red palette,
subtle borders/elevation), polished motion (page transitions, list stagger, card flip, NFC ripple, success
micro-animations), dark and light themes, no overflow at 320 dp / 1.3× text.
