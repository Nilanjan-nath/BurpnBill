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
(`POS.jsx`), Staff (`StaffTab.jsx`), the order board (`ActiveColumns.jsx` / `OrderCard.jsx`) and
the order detail drawer (`OrderDetailDrawer.jsx`).
**Not yet migrated** — still the older plain-CSS dark theme (`staff.css`, scoped to
`.staff-legacy`): Recent, Menu, Tables, and the Dashboard placeholder. A known, temporary seam,
not a design decision. `Board.jsx` decides which tabs get `.staff-legacy`; take a tab out of
that list when you migrate it.

### The order board

The kitchen's own screen, so it is read from further away than anything else here and gets the
loudest treatment in the system:
- Each column is a white panel with a 1px accent bar on top and its count in a pill: **New =
  amber** (waiting on someone), **Preparing = teal** (work in hand), **Ready = emerald** (done).
  That is the status palette doing its actual job — deliberately not the reference screenshot's
  blue/orange
- A card leads with the **table**, not the order number: that is what the kitchen calls out.
  The order number below it is the link into the detail drawer
- The forward button is coloured by **where the order is going**, so button and destination
  column are visibly the same thing; it is full-width, uppercase, and has `active:scale-[0.98]`
  so a tap on a tablet feels like a press
- An order sitting too long gets a whole-card ring (amber at 5 min, red at 10) rather than only
  a tinted age — it has to read across a kitchen, not reward close inspection
- Columns scroll independently at `lg` and stack into one scrolling page below it

## The one rule that matters most

**Take real inspiration from other products' *structure* (a sidebar + cards + a contextual
side panel is a good pattern), never their literal colors or pixel layout.** If a reference
screenshot's blue happens to be what we'd have picked anyway, fine — but the palette below was
chosen to read as our own, not as a copy. When in doubt, ask "would this look the same if I'd
never seen the reference?" — if not, change it.

### Worked example: the "DineFlow" POS reference

The owner brought a second reference (a POS called DineFlow) and asked for Petuk to look like
it. What that turned into, as a record of how this rule gets applied in practice:

**Taken** (structure and emphasis): a solid-filled active nav item; a brand monogram beside the
wordmark; an at-a-glance count strip over the floor map ("2 Occupied / 4 Free"); richer table
cards that show the live order, not just a status word; two-letter monograms on item cards; a
filled header bar on the cart panel; a boxed total above the CTA; and — most importantly —
much heavier type and stronger contrast throughout.

**Not taken**: its blue (we keep teal, for the reason above); its per-category pastel item-card
tints (see "what color is *not* for"); and every feature Petuk doesn't have — Waitlist, Merge
Tables, Clock In, Dine-in/Take-away, order priority, VIP flags,
Inventory/Customers/Reports nav. Drawing UI for features that don't exist would be faking
capability, which is worse than looking plainer.

**Taken in a second pass** (the same reference's bill/checkout screens): a busy table carrying
its running total, a Cart/Ongoing split on the order panel, an "N unpaid orders · running total"
notice, and an itemised checkout dialog with a payment method. These were built because the data
and schema were genuinely there — `payments.method` is already a `cash|card|upi` enum. Still not
taken, for exactly the "don't fake capability" reason: discount, tip, split bill, partial
payment and tax, none of which have any schema behind them.

**A surface always declares its own background and text color.** Found the hard way: the
checkout `<dialog>` had neither, so it fell back to the UA's `canvas` color — dark under
`prefers-color-scheme: dark` — and its gray text became unreadable on near-black. Whenever you
add a panel, dialog, popover or sheet, set `bg-*` and a text color on it explicitly rather than
inheriting whatever is underneath.

**A modal `<dialog>` also needs `m-auto`.** Tailwind's preflight sets `margin: 0` on every
element, which overrides the `margin: auto` the browser uses to centre a `showModal()` dialog —
without it the panel sticks to the top-left corner of the viewport. Same root cause as the
background above: the reset takes something the UA was providing for free.

## Color

**Base** — white/off-white, not brand-colored:
- Page background: `bg-gray-50`
- Cards/panels/sidebar/header: `bg-white`
- Borders: `border-gray-200` (`border-gray-300` where a control needs to read as a control —
  outlined buttons, inputs)
- Text: `text-gray-900` (headings/primary), `text-gray-700` (secondary), `text-gray-600`
  (tertiary — category labels, timestamps). **`text-gray-500` is the lightest text allowed,
  and only on a tinted/filled background, never small gray-on-white.** `text-gray-400` is for
  icons only, never text.

**Why the floor is set there**: the first version of this system used
`text-gray-500`/`text-gray-400` at `font-medium` for everything secondary, which is thin enough
that it has no margin for error. It isn't what actually broke (see the cascade note below), but
it's why the breakage was total rather than merely ugly — there was nothing left to read once
anything went wrong. Pick colors that still work when something else is fighting you.

### The cascade bug that made the dashboard unreadable

Worth knowing about, because it will happen again to anyone adding CSS here. The owner reported
the whole sidebar as invisible on a Mac while the same build looked correct on Windows. Two
wrong diagnoses came first (Tailwind v4's oklch palette; then macOS font antialiasing). The
actual cause:

`web/src/styles.css` is the **customer** app's stylesheet, but `main.jsx` imports it for every
route, so it also loads on `/staff`. Its global element resets were **unlayered**, and
unlayered CSS outranks anything inside a cascade layer *regardless of specificity* — and
Tailwind v4 puts every utility in one. So `button, input, textarea { color: inherit }` silently
beat every `text-*` class in this dashboard, and each button inherited the customer palette's
`body` color. Under `prefers-color-scheme: dark` that color is near-white — hence near-white
text on the dashboard's white panels, on a Mac in dark mode, and no problem at all on a machine
in light mode. `h1, h2 { font: … var(--font-display) }` beat the heading utilities the same way,
which is why page titles rendered in Fraunces.

The fix was to wrap those element rules in `@layer petuk-customer` (a no-op for the customer
app, which has no layered CSS of its own) so the dashboard's utilities win. **If you add global
element styles to `styles.css`, put them in that layer**, or they will leak into a design system
that isn't theirs. Class-based rules there stay unlayered on purpose — `.veg-mark` is shared
with this dashboard deliberately.

**One primary accent — teal**, used for the single most important thing per screen (the active
nav item, the primary CTA, the selected table, the cart panel's header):
- Solid: `bg-teal-600` / `text-white` — the active sidebar item, the active category pill, the
  selected table card, the cart header bar, and the "Send to kitchen" CTA (that one in a
  `from-teal-600 to-cyan-600` gradient). **Selection and "you are here" are always a solid
  fill, not a tint** — a soft `bg-teal-50` active state was too weak to answer "which tab am I
  on?" at a glance.
- Soft: `bg-teal-50 text-teal-700` — supporting accents only: the item-card monogram, a price.

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
- **Pending / waiting**: amber. Now in real use as the order board's *New* column and on a
  QR order awaiting approval — "someone needs to act on this". Still not a floor-map state
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
- Page titles: `text-2xl font-bold text-gray-900`
- Section/panel titles: `text-base font-bold text-gray-900`
- Card titles and item names: `text-sm font-bold text-gray-900`
- Secondary text: `text-xs font-semibold text-gray-600` / `text-sm font-semibold text-gray-700`
- Money and counts: `font-bold` — these are the numbers someone is actually reading under time
  pressure, so they get the most weight on the card
- **`font-semibold` (600) is the floor for anything small or gray**; `font-medium` and
  `font-normal` are effectively unused here. Two weights per screen is still the goal, they're
  just `font-semibold` and `font-bold` now rather than `font-medium` and `font-semibold`.
- Headings inherit the sans stack via a `.staff-app :is(h1, h2, h3) { font-family: inherit }`
  rule in `tailwind.css` — the customer stylesheet sets Fraunces on `h1`/`h2` and Tailwind has
  no font-family utility on those elements to override it with. Don't remove that rule without
  checking a page title first.

## Shape, elevation, spacing

- Radius: `rounded-xl` (buttons, inputs, small cards), `rounded-2xl` (item/table cards),
  `rounded-full` (pills, badges, avatars)
- Elevation: `shadow-sm` at rest on interactive cards, `hover:shadow-md` — never more than
  that; this isn't a marketing page
- Borders stay thin (`border`, i.e. 1px) and light (`border-gray-200`) — no heavy dividers
- Panel padding: `p-4` standard, `p-6` for a page-level header
- Grid gaps: `gap-3` (dense card grids), `gap-4` (looser layouts)

## Layout pattern

- **Sidebar**: fixed width (`w-64`), a brand mark at top (teal rounded-square monogram + the
  wordmark), vertical nav (icon + label, active = solid `bg-teal-600 text-white`), identity
  card pinned to the bottom in its own `bg-gray-50 rounded-2xl` block. Doesn't yet collapse for
  narrow screens — a known gap, not solved yet (this dashboard has been tablet/desktop-first
  since step 4)
- **Header**: page title (changes per tab) + live-connection status as a pill on the left,
  actions on the right as outlined buttons (`border-gray-300`, icon + label) rather than bare
  text links — a bare underlined link was another casualty of the contrast problem above
- **Content**: a grid of cards for anything list-like (tables, menu items), each with a status
  badge/price and a clear single primary action. Item cards carry a two-letter monogram
  (`bg-teal-50 text-teal-700`) as a scanning aid — one consistent treatment for every item,
  *not* a per-category color, which would be exactly the decoration the color rules rule out
- **Status-bearing cards** (the floor map) show the underlying record, not just a badge: order
  number and how long the table's been occupied, so the panel answers "what's going on" without
  opening anything
- **Contextual side panel** (POS's cart is the first example): a filled accent header bar, a
  clear empty state (icon + bold line + supporting line), a running total in its own boxed
  `bg-gray-100` row, and one prominent CTA pinned to the bottom — never buried in a scrolling
  list

## Icons

`lucide-react`, one per nav item, `h-[18px] w-[18px]`, always `aria-hidden="true"` (the label
text is what a screen reader announces, the icon is decoration on top of it, never instead of
it).
