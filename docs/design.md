# Design and styling

tracey follows the **GGX docs design system** (docs.genguardx.ai), so tracey views look at
home next to GGX docs and products.

> Source: values below were read from the live site's compiled stylesheet on 2026-10-16
> (Astro + Starlight, with GGX overrides). The GGX source repo is private to us, so re-check
> the site if it changes. Items marked **(proposal)** are tracey-specific extensions, not
> taken from GGX.

## Principles

- **Quiet and precise.** Slate surfaces, hairline borders, one blue accent. Colour is for
  meaning, so a red or orange mark should always mean something.
- **Dark and light, equal citizens.** Three modes: Dark, Light, Auto (follows OS). Every
  component ships all three from day one.
- **Dense but breathable.** Trace UIs are data-heavy. Use the type scale and 0.5/0.625rem
  radii consistently instead of inventing sizes.
- **Fast to paint.** Tokens are CSS custom properties; theme switches are a single attribute
  flip with no re-render.

## Theming mechanism

Tokens are CSS custom properties on `:root`. Light overrides sit under
`:root[data-theme=light]`. Auto mode sets the attribute from `prefers-color-scheme`.
tracey packages read tokens, never hard-code colours. Canvas renderers read the resolved token
values once per theme change (`getComputedStyle`) and cache them.

Token names: tracey uses its own `--tracey-*` names that alias the GGX values, so embedding
apps can override them without knowing GGX. **(proposal)**

## Colour tokens

### Dark (default)

| Role | GGX variable | Value |
|---|---|---|
| Page background | `--sl-color-black` | `#0d1219` |
| Surface (cards, panels) | `--ggx-surface` = gray-6 | `#171d28` |
| Hairline / border | gray-5 | `#2a3342` |
| Muted text / disabled | gray-4 | `#556072` |
| Secondary text | gray-3 | `#94a0b3` |
| Body text | gray-2 | `#c3cad6` |
| Strong text | gray-1 | `#e5e9f0` |
| Headings / max contrast | white | `#f8fafc` |
| Accent | accent | `#0b76cc` |
| Accent text/link | accent-high | `#7cc4fd` |
| Accent tint | accent-low | `#0b2a47` |
| Hover fill | `--ggx-hover` | `#94a3b81a` |
| Active/selected fill | `--ggx-active` | `#0c8ce929` |
| Inline code bg | | `#94a3b829` |

### Light

| Role | Value |
|---|---|
| Page background | `#ffffff` |
| Surface | `#f7f9fb` (gray-7) |
| Hairline / border | `#d5dbe3` (gray-5); subtle dividers `#e6eaef` (gray-6) |
| Muted text | `#8a94a3` (gray-4) |
| Secondary text | `#566072` (gray-3) |
| Body text | `#374151` (gray-2) |
| Strong text | `#111827` (gray-1) |
| Headings | `#030712` |
| Accent | `#006fc9` |
| Accent text/link | `#0257a2` |
| Accent tint | `#e3f1ff` |
| Hover fill | `#1118270b` |
| Active/selected fill | `#0c8ce91a` |

### Status colours

GGX inherits Starlight's hue-based palette; only orange is overridden. Hues:
green 101, blue 234, purple 281, red 339, orange 41 (GGX override: `#f97316` dark,
`#c54600` light, tints `#3b1d06` / `#fff7ed`).

| Role | Dark | Light |
|---|---|---|
| Error / critical | `hsl(339 82% 63%)` | `hsl(339 90% 60%)` |
| Warning | `#f97316` | `#c54600` |
| Success | `hsl(101 82% 63%)` | `hsl(101 90% 46%)` |
| Info | accent | accent |
| Purple (agent/other) | `hsl(281 82% 63%)` | `hsl(281 90% 60%)` |

Each status also has `-low` (tint background) and `-high` (text on tint) variants, as in
Starlight: dark low `hsl(h 39% 22%)`, light low `hsl(h 80-90% 88-90%)`.

### Span-kind colours **(proposal)**

Needed for timeline and graph. Built only from the palette above so it stays on-brand; must
be re-validated for contrast and colour-blind safety (pair colour with an icon/shape, never
colour alone).

| Kind | Colour |
|---|---|
| agent | purple |
| llm | accent blue |
| tool | green |
| retrieval / embedding | blue-high / teal-ish tint of accent **(to design)** |
| chain / workflow / other | gray-3 |
| error overlay | red, any kind |

## Typography

| Use | Font |
|---|---|
| UI text | **DM Sans** (400, 600), fallback `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif` |
| Code, ids, JSON, numbers in tables | **DM Mono**, fallback `ui-monospace, SFMono-Regular, Consolas, monospace` |

Scale from GGX: h1 2.125rem, h2 1.5rem, h3 1.25rem, h4 1.0625rem, h5 1rem. Line height 1.65
body, 1.2 headings. For dense tracey chrome **(proposal)** use `--sl-text-sm` (~0.875rem) as
the default and tabular numerals (`font-variant-numeric: tabular-nums`) for durations, tokens
and cost so columns align. Ship DM Sans/Mono subsets as woff2 (latin only) and `font-display:
swap`; the viewer must be usable before fonts load.

## Shape, depth, spacing

- Radius: `0.5rem` controls and inputs; `0.625rem` cards, panels, asides.
- Borders: 1px hairline (`gray-5`). Prefer borders over shadows.
- Shadows exist but are used sparingly: `sm`, `md` for popovers; menus use
  `0 12px 28px -16px #03071259`.
- Cards: surface background, 1px hairline, 1.25rem padding, 0.625rem gap.
- Callouts/asides: 1px border at 40% of the status colour, background 9% status colour mixed
  into page bg (`color-mix`). tracey uses this for findings.
- Controls: 2.25rem height (search, menu buttons, selects), `0.35rem 0.75rem` padding,
  14px text, weight 500.
- Selected row/item: `--ggx-active` fill, accent text, weight 600. Hover: `--ggx-hover`.
- Layout: max page width 90rem, header bar 3.5rem, sidebar 18rem.
- Transitions: 150ms for border/background colour only. No animation on data rendering.

## Responsive tokens **(proposal)**

GGX docs use a 90rem max page width, 18rem sidebar, 3.5rem header bar. tracey keeps the
header height and radii but adapts the rest to container width (see
[ux-principles.md](ux-principles.md#responsive-by-default-decided)): container-query
breakpoints at 40rem, 64rem, 112rem; spacing scales with `rem`; coarse-pointer controls grow to
44px minimum.

## Logo

Two SVGs, white and black variants, swapped with the theme (`ggx-white`, `ggx-black`).

## tracey-specific UI rules **(proposal)**

- Canvas draws use the same tokens; no off-palette colours in charts.
- A finding badge is always: icon + severity colour + short text. Never colour only.
- Focus ring: 2px accent, offset 2px, always visible on keyboard focus.
- Respect `prefers-reduced-motion`; respect `prefers-contrast`.
- Text selection and copy must work everywhere payloads are shown, including canvas views
  (provide a DOM text layer or detail panel).
