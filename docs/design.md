# Owner dashboard — design system

*Applies to the staff/owner dashboard (sidebar, header, POS, and — over time — every other
tab). The customer-facing app (`web/src/styles.css`) is a separate, deliberately different
design language (warm off-white/terracotta, Fraunces serif) and isn't covered here — see
`ARCHITECTURE.md` §8 for why they're split.*

## Where this actually lives today

Tailwind CSS v4 (`@tailwindcss/vite`, no `tailwind.config.js` — v4's zero-config default),
`lucide-react` for icons, both imported only from `web/src/staff/tailwind.css` (itself only
imported by `StaffApp.jsx`), so none of it reaches the customer bundle. Verified with a
production build.

**Migrated to this system:** the sidebar (`Sidebar.jsx`), the shared header (`Board.jsx`), POS
(`POS.jsx`).
**Not yet migrated** — still the older plain-CSS dark theme (`staff.css`, scoped to
`.staff-legacy`): Board, Recent, Menu, Tables, the Dashboard and Staff placeholders. This is a
known, temporary seam, not a design decision — the plan is to bring every tab onto the system
below over time, one slice at a time, the same way POS was.

## The one rule that matters most

**Take real inspiration from other products' *structure* (a sidebar + cards + a contextual
side panel is a good pattern), never their literal colors or pixel layout.** If a reference
screenshot's blue happens to be what we'd have picked anyway, fine — but the palette below was
chosen to read as our own, not as a copy. When in doubt, ask "would this look the same if I'd
never seen the reference?" — if not, change it.

## Color

**Base** — white/off-white, not brand-colored:
- Page background: `bg-gray-50`
- Cards/panels/sidebar/header: `bg-white`
- Borders: `border-gray-200`
- Text: `text-gray-900` (headings/primary), `text-gray-500` (secondary/muted), `text-gray-400`
  (tertiary — category labels, placeholders)

**One primary accent — teal**, used sparingly for the single most important thing per screen
(the active nav item, the primary CTA, a selected state):
- Solid: `bg-teal-600` / `text-white` (the "Send to kitchen" button, in a
  `from-teal-600 to-cyan-600` gradient)
- Soft: `bg-teal-50 text-teal-700` (active sidebar item, selected table's badge, category
  filter's active pill uses the solid version instead — see POS.jsx for both patterns in
  context)

Why teal and not blue: the reference screenshots we looked at (and most competitor POS
products) lean on blue as their primary color. Teal reads as premium and calm the same way,
without being the same choice — see "the one rule that matters most" above. It's also
deliberately not red/orange/amber, so it never competes with status color for attention.

**Status color — and only status color communicates state**, always a soft pastel (colored
text on a light tint of the same hue), never a hard fill except where noted:
- **Free / available**: `bg-emerald-50 text-emerald-700` (soft), `border-emerald-200` /
  `bg-emerald-50` (a stronger card-level treatment, e.g. a free table)
- **Occupied / busy**: `bg-red-50 text-red-700` (soft), `border-red-200` / `bg-red-50` (card
  level)
- **Pending / waiting**: `bg-amber-50 text-amber-700` — reserved for a future third floor
  state (e.g. "bill requested"); not in use yet, don't invent a use for it prematurely
- **Veg / non-veg**: a small green or red dot (`.veg-mark`, ported from the customer app) —
  this is food-safety information, not decoration, and is the one place a small dot of color
  belongs directly on an item card. It is not part of the status-color system above; don't
  reuse green/red-for-veg to also mean free/occupied or vice versa — different question,
  different color pair, kept visually distinct (a dot vs. a badge/border) so they're never
  ambiguous next to each other

**What color is *not* for**: decorating food item cards, category headers, or anything else
just to look lively. The brief's own words: "clarity beats decoration — this is a tool
restaurant staff will use dozens of times a day under time pressure." A grid of 30 randomly-
tinted item cards is noise, not information. If you want an item card to stand out, use
elevation (shadow) or the veg dot, not a new color.

## Typography

System sans throughout (Tailwind's default stack) — no display/serif font here, unlike the
customer app's Fraunces. This is a work tool, not a brand moment; hierarchy comes from weight
and size, not typeface:
- Page/section titles: `text-lg font-semibold text-gray-900`
- Card titles: `text-sm font-semibold text-gray-900`
- Secondary text: `text-sm text-gray-500` or `text-xs text-gray-400`
- Never more than two weights on one screen (`font-medium` / `font-semibold` — regular and
  bold both exist but stay unused so the hierarchy stays simple)

## Shape, elevation, spacing

- Radius: `rounded-xl` (buttons, inputs, small cards), `rounded-2xl` (item/table cards),
  `rounded-full` (pills, badges, avatars)
- Elevation: `shadow-sm` at rest on interactive cards, `hover:shadow-md` — never more than
  that; this isn't a marketing page
- Borders stay thin (`border`, i.e. 1px) and light (`border-gray-200`) — no heavy dividers
- Panel padding: `p-4` standard, `p-6` for a page-level header
- Grid gaps: `gap-3` (dense card grids), `gap-4` (looser layouts)

## Layout pattern

- **Sidebar**: fixed width (`w-60`), brand mark at top, vertical nav (icon + label, active =
  filled `bg-teal-50 text-teal-700` rounded background), identity card pinned to the bottom.
  Doesn't yet collapse for narrow screens — a known gap, not solved yet (this dashboard has
  been tablet/desktop-first since step 4)
- **Header**: page title (changes per tab) + live-connection status on the left, primary
  actions (sign out, sound toggle) on the right
- **Content**: a grid of cards for anything list-like (tables, menu items), each with a status
  badge/price and a clear single primary action
- **Contextual side panel** (POS's cart is the first example): tabs or a clear empty state,
  a running total, one prominent CTA pinned to the bottom — never buried in a scrolling list

## Icons

`lucide-react`, one per nav item, `h-[18px] w-[18px]`, always `aria-hidden="true"` (the label
text is what a screen reader announces, the icon is decoration on top of it, never instead of
it).
