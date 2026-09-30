# BurpnBill — design system

*Two systems live in this repo. **The BurpnBill brand system** (below) governs the landing page
(`/`), the sign-in and create-your-café screens, and every tab of the staff dashboard
(`/staff`). **The customer app** (`/t/<token>`) has its own, deliberately different language —
white and red, described under "The customer app" — and is untouched by the brand system until
the owner decides otherwise.*

*Everything from "Where this actually lives today" down was written for the earlier teal
palette. The traps, the "what colour is not for" reasoning and the worked examples still hold;
where a section names `teal`, `gray-*` or a specific Tailwind colour, read it as the brand token
in the mapping table below. The palette, type and shape sections lower down are marked
superseded.*

## The BurpnBill brand system

Source: the owner's *BurpnBill — Brand System* sheet and the `bnb.svg` logo. Implemented as
Tailwind v4 theme tokens in `web/src/brand/tokens.css`, imported by `staff/tailwind.css` and
`landing/landing-tailwind.css` and by nothing else — so, like Tailwind itself, it ships in those
two lazy chunks only and the customer bundle contains none of it (verified in a production
build).

### The logo

`web/src/brand/Logo.jsx`, drawn from `bnb.svg` and otherwise unaltered. Four colourways, and only
these four:

| Variant | Letters on ground | Use |
|---|---|---|
| `white` | crimson on nothing | the default, on white or the cream canvas |
| `cream` | crimson on butter | a butter tile |
| `crimson` | white on nothing | on a crimson band |
| `ink` | butter on nothing | on warm ink — the sidebar, the closing band |

Clear space is the height of the "b" on every side; minimum width on screen is 72px. There is
**no square icon**: the brand has none, and inventing a monogram would be altering the mark, so
the dashboard uses the wordmark alone and there is no favicon of it yet. Each instance prefixes
its clip-path ids (`useId`), so a nav and a footer on one page do not share them.

### Colour (`tokens.css`)

- **Crimson** `brand-50…900`, `#A70045` = 600. *Crimson means "do this"* — primary actions, the
  active nav item, selection. It is never used for a number, an error or a status. One primary
  button per view (the board's per-card forward buttons are the exception: each card is its own
  view).
- **Butter** `butter-50…900`, `#F4F0A9` = 300. Highlight and accent: role chips, monograms,
  "Bill & checkout", warnings. Never a text colour on white.
- **Ground:** `canvas` `#FFFCF0` (the page) and `paper` white (cards). **Ink** `ink-50…900`
  replaces Tailwind's cold `gray`; `ink-500` is the lightest text allowed.
- **Status pairs** (`placed`, `prep`, `ready`, `served`, `cancelled`, each with `-ink`): amber,
  blue, green, grey, and muted-with-strikethrough. Defined once in `brand/status.js`, drawn by
  `brand/StatusPill.jsx` (a dot **and** the word — colour is never the only signal). Contrast is
  asserted in `brand/brand.test.jsx`.
- **Danger** `danger-*`, `#D92D20`: errors and destructive actions only. Deliberately not crimson.
- **Veg / non-veg** `veg`, `nonveg`: the food-safety marks, the same greens and reds as the
  customer app's veg mark.

**Deviations from the sheet, on purpose:**

1. `cancelled-ink` is `#5C4C54` (ink-600), not the sheet's `#7A6A72`. On its tint the sheet's pair
   measures 4.43:1 — just under AA for text this small — and the test suite holds every status
   pair to 4.5:1.
2. The sheet says white on crimson is 8.6:1; measured, it is 7.7:1 (still AAA). The test asserts
   the measured value.
3. The sheet defines only the base danger colour; the 50/100/200/600/700 steps are this repo's own
   ramp, so a danger banner has the same recipe as every other banner.
4. The sheet describes a 64px icon rail. The dashboard keeps its 256px labelled sidebar (a rail
   of icons alone is a worse way to find "Recent") and takes the rail's *colours*: warm ink ground,
   butter wordmark, crimson active item.

### Type

Self-hosted variable fonts (`@fontsource-variable/*`, imported in `tokens.css`, so no third-party
request and nothing for a customer's phone to download): **Bricolage Grotesque** for headings
(`h1`–`h4`, applied in `@layer base`, weight 800 for h1/h2), **Manrope** for everything else,
**JetBrains Mono** for prices, table numbers, order ids, times and the small uppercase labels
(`font-mono text-xs font-bold uppercase tracking-[0.08em]`). Money and counts are always mono so
digits align and totals do not jitter.

### Shape, depth, motion

`rounded-card` (12px) for cards, buttons and panels; `rounded-input` (8px) for fields and small
controls; `rounded-full` for status pills. **Borders first, shadow second:** the only elevation is
`shadow-pop` (`0 8px 24px rgb(30 20 24 / .12)`), on dialogs and the drawer. Taps use
`duration-150 ease-tap` and `active:scale-[0.98]`.

### Targets

Primary actions are **48px** (`min-h-12`): the board's forward and cancel buttons, POS, checkout,
sign-in, tabs. Dense admin lists (seating list, staff list, menu cards' small controls) keep
smaller controls, never below 36–40px. This was a deliberate split: 48px everywhere would have
meant re-laying-out those screens.

### Occupied is not danger

POS's floor map and the seating plan draw **occupied as a crimson tint** and **free as the
"ready" green**; the selected table is solid crimson. A busy table is not an error, and the brand
keeps danger and crimson apart. (The owner's earlier ask — "red when busy, green when available"
— is kept in spirit: the tint is red-leaning.)

### Light only, for now

Neither surface has dark styles. `tokens.css` declares `color-scheme: light` for anything inside
`.brand-surface` (scoped through `:has`, so it can never follow the customer app onto its own
route) and paints `body` in the canvas, so a Mac in dark mode gets the same page a light one does.
The sheet defines dark tokens; adopting them is a separate piece of work, not a side effect of
this one.

### Old class → new token

| Was | Now |
|---|---|
| `teal-*` (accent) | `brand-*` |
| `gray-*` | `ink-*` (`text-gray-400` → `ink-500`) |
| `bg-white` | `bg-paper` (page: `bg-canvas`) |
| `amber-*` (waiting) | `placed` / `placed-ink`; warnings: `butter-100` + ink text |
| Preparing `teal` | `prep` / `prep-ink` (blue) |
| `emerald-*` | `ready` / `ready-ink` |
| `red-*` | `danger-*` (errors), `brand-*` tint (occupied), `cancelled` (cancelled) |
| `rounded-xl`, `rounded-2xl` / `rounded-lg` | `rounded-card` / `rounded-input` |
| `shadow-sm`, `shadow-md` | none (borders); dialogs `shadow-pop` |

`brand/brand.test.jsx` fails if a class from Tailwind's default palette reappears under `staff/`
or `landing/`, so this table stays true.

### Traps found doing this

- **A `border-l-*` colour and a `border-*` colour on one element** are both `border-color`-family
  utilities; the left edge only wins because Tailwind emits `border-l-*` later. The order card
  relies on it, and its stuck highlight (`border-placed-ink`, all four sides) deliberately
  overrides it.
- **Tests that assert a colour class** (`toHaveClass('bg-teal-50')`) break on a re-skin without
  the feature having changed. Two did; they now assert the brand class. Prefer a `data-*` hook
  (the stuck highlight already has one).
- **The brand sheet's own numbers are worth measuring.** Two were slightly off (above).
- **`staff.css` is gone.** Sign-in, create-your-café and StaffApp's loading/error states share
  `staff/AuthShell.jsx`, which closed the last surface on plain CSS.

---

## Where this actually lives today

Tailwind CSS v4 (`@tailwindcss/vite`, no `tailwind.config.js` — v4's zero-config default),
`lucide-react` for icons, both imported only from `web/src/staff/tailwind.css` (itself only
imported by `StaffApp.jsx`), so none of it reaches the customer bundle. Verified with a
production build.

**Migrated to this system:** the sidebar (`Sidebar.jsx`), the shared header (`Board.jsx`), POS
(`POS.jsx`), Staff (`StaffTab.jsx`), the order board (`ActiveColumns.jsx` / `OrderCard.jsx`),
the order detail drawer (`OrderDetailDrawer.jsx`), the Dashboard (`DashboardHome.jsx`),
the Menu (`MenuTab.jsx` / `ItemForm.jsx` / `CategoryForm.jsx`), Settings
(`SettingsTab.jsx` / `RestaurantProfile.jsx` / `SeatingPlan.jsx` / `UserAccount.jsx`) and
Recent (`RecentOrders.jsx`).

**That is all of them, and the sign-in / create-your-café screens too.** `staff.css` has been
deleted; `staff/AuthShell.jsx` is the frame those screens share.

### Settings

Three views behind one tab, and the split is the point: **Restaurant Profile** and **Seating
Plan** are the café's, so they are the owner's; **User Account** is your own name and password,
which every role needs and none should have to ask the owner for. A kitchen login therefore
opens straight onto User Account — and gets **no tab strip at all**, rather than tabs it can't
use. A disabled control you can see is an invitation to ask why.

- Each view is a **card with its own header strip** (`bg-gray-50`, title + one line saying what
  it's for) and its actions pinned to a footer strip of the same colour. Settings is read far
  more often than it is changed, so the save lives at the end of the thing it saves rather than
  floating over it
- **Save is disabled until something actually changed**, and a `Saved` tick appears beside it
  afterwards. Without the tick, a form that looks identical before and after gives no sign it
  worked
- A field the owner can't change isn't hidden from staff — it is `disabled` and reads as flat
  (`disabled:bg-gray-50`), so a non-owner can still see the café's own details
- The seating plan keeps the printable QR sheet, and warns before printing when the page's own
  origin is `localhost` — the codes encode wherever you're browsing from (see `qr.js`), so a
  sheet printed from a dev address is twenty dead links

### The floor plan

The room, drawn on a 12x8 dotted grid (`FloorPlanCanvas.jsx`). The dots are the affordance:
they say "things go on squares" without a legend explaining it.

- **Three statuses, because three are all this app can know.** Available and occupied come from
  real orders (the same definition `GET /floor` has always used); paused is a real column.
  A reference legend offering Waiting, Dirty and Reserved was not copied — nothing records
  them, and colouring a table "dirty" the app can't know about is the same fake capability as
  an AI description button that calls nothing
- **A drag shows its work.** The card follows the cursor (lifted — scaled, raised, shadowed)
  rather than sitting still and teleporting on release, and the square it would land in is
  outlined as you go: teal when free, **red when taken**, with a line saying which row and
  column, or "That square is taken". Escape abandons it. The hint sits at the *bottom* of the
  plan — a room fills from the top, so a banner across the top row covers the tables you are
  looking at.
- **The outline follows the CARD, not the cursor.** Grab a card by its corner and the two are
  half a cell apart; the square that lights up has to be the one the card is sitting over,
  because that is what the eye reads. Computed from the table's own cell plus the drag delta,
  so it needs no layout of its own and works the same in a test.
- **The lift's scale belongs in the inline `transform`, never in a `scale-*` class.** Tailwind
  v4 compiles `scale-110` to the standalone `scale` property, which composes *after*
  `transform` — so the class silently multiplies the drag translation by 1.1 and the card
  drifts a cell away from the square it claims it will land on. Found by measuring the card
  and its target in a browser; it looked plausible in a screenshot. This is what the first version got
  wrong: a refused drop was silent, so letting go and seeing nothing happen read as a bug
  rather than as an answer
- **Selection links the two halves of the screen.** Clicking a table on the plan highlights its
  row in the list, and the row's name finds it on the plan. Twenty tables in a list is a
  guessing game otherwise — "which of these is the one in the far corner?"
- **Every table is a real `<button>`, and the arrow keys move it a cell at a time.** A plan you
  can only arrange by dragging is a plan half the people here can't use. The pointer and the
  keyboard both go through one `moveTo`, so they can't drift apart, and neither can stack two
  tables — which the database refuses as well (see `schema.md`), so the client check is purely
  about not throwing a 409 banner at someone for a drop that was never going to work
- **POS draws the same arrangement, with its own cards.** Those cards carry a running total and
  how long a table has been sitting; they can't shrink to a twelfth of the panel and still say
  that. So the used rows and columns are *compacted* (`floorLayout.js`): a plan using columns
  0, 3 and 7 becomes three columns of full-size cards. What survives is which tables are next
  to each other; what's dropped is empty floor, which is a property of the room rather than of
  the service
- Retiring a table asks inline and **says what happens to its orders** ("Its past orders
  stay") — next to a trash icon, "remove" reads like it takes the history with it, and here it
  genuinely could have

### The Menu tab

The owner's catalog, and the only screen here with photography on it:
- An item is a **card**, not a row: a fixed-height (`h-32`) photo area on top, then name, price,
  description and the 86 toggle. Cards because a photo is the fastest way to find a dish in a
  list of thirty, and a row can't carry one without becoming a thumbnail nobody can read
- **No photo falls back to the item's two-letter monogram** on `bg-teal-50 text-teal-700` —
  the same one treatment for every item, never a per-category tint (see "what color is *not*
  for"). An owner part-way through uploading photos gets a grid that still reads as one thing
- Edit and delete sit **on the photo, revealed on hover**, so thirty cards aren't sixty
  competing buttons. They are `focus-within:opacity-100` as well as `group-hover`, or they
  would be unreachable by keyboard
- The category pill sits on the photo bottom-left; **86'd** is a hard red fill top-right, the
  one place a hard status fill is allowed here, because an unavailable item has to be
  findable at a glance in a full grid. The card also drops to `opacity-70`
- A second view, **Categories**, is a plain list: display order in a teal monogram square,
  name, live item count. Deleting one says *"Move 4 to Uncategorised?"* rather than "Delete?"
  — next to a section holding four dishes, "delete" reads like it takes them too
- The veg/non-veg dot keeps `role="img"` and a real label. It is food-safety information, so
  it is announced, not merely seen — which is also why a test looking for "no photo here"
  has to ask for an `<img>` element rather than `queryByRole('img')`

### The customer app (`/t/<token>`)

What someone sees seconds after scanning a code at their table: hungry, slightly impatient,
no login, no app. Built from an owner-supplied reference (a coloured header, a search bar with a
filter icon, category tabs, a list of dish rows with a "+" on the right, a bar pinned to the
bottom), on Tailwind's default utilities, in its own lazy chunk.

- **One accent: red (`red-600`), on white.** It is the header pill, the active tab, the search
  button, the outlined "+" on every row, and — as a solid fill — the one action per screen (View
  order, Place order, Add · ₹X, View bill). Solid red is `-600` because white on it is 4.8:1,
  which passes for small text too; `red-500` did not. Secondary actions are `red-50` with `red-700`
  text. History, because it cost three rounds: the first version was a **mustard** frame with red
  for the main action, and the owner found it "too bright"; a lavender page and deeper gold read
  as "exactly the same"; on a white page, **gold did not suit** and red did. The reference
  screenshot's own gold and coral are the exception that proves the rule — they work on its
  lavender screens and not on white
- **Red is for actions, green is for "it worked".** The order-placed tick is `green-600`: on
  this palette a red circle with a tick reads as an error, which is the opposite of what someone
  who has just ordered needs to feel. The buttons below it stay red — they are actions, not
  status. Same rule as the dashboard's: colour that means a state is kept apart from colour that
  means "tap here"
- **Light is white, dark is near-black, and it follows the phone.** Owner feedback on the early
  passes was "too bright", then — after a lavender page and a deeper yellow that read as "exactly
  the same" — "make the background white, something close to Zomato or Swiggy, the user should
  feel hungry". So light is a white page, cards lifted by a soft shadow rather than a border, a
  plain white header with the table as a red pill, the search as a pill with a red circle holding
  the icon (from the reference), and a soft `red-50` placeholder square. Dark mode was switched
  off for that review (one `@custom-variant` line) and then **back on at the owner's request**,
  through Tailwind's default `dark:` variant. It flips as a set — `stone-950` page, `stone-900`
  cards with a border instead of a shadow (a shadow means nothing on black), red-tinted `red-950`
  pills and tiles, outlined "+" buttons with no fill — and red stays the only accent. **The
  `dark:` classes written for the mustard palette had to be revisited**: they still pointed at
  colours that no longer existed. Every surface names its own background and text colour
- **A row is: photo, name with the veg mark, one line of description, price, "+".** The photo is
  a fixed `h-24 w-24` square so rows don't jump as images load. **No photo gets a soft `red-50`
  square with a fork-and-knife icon, in the same place** — not a gap, and not an `<img>` (there
  is nothing to announce and nothing to break). Nobody has uploaded a photo to the live café
  yet, so today *every* row is the placeholder; it has to look intentional, not like a fault
- **The "+" (an outlined red circle) still opens the item sheet** rather than adding straight to the cart. The sheet is
  where the special-instructions note lives, and "less sugar" is the whole point of ordering
  from your phone. One tap to add is a shortcut that would delete a requirement
- **Search and the tabs are sticky together**, so nobody scrolls back to the top to look for
  something else. The input is `text-base` (16px): iOS Safari zooms the whole page on focus for
  anything smaller
- **Tabs are a filter, not a scroll-to.** "Beverages" shows Beverages; "All" shows everything.
  They compose with search and the veg filter, and *Clear search and filters* on the empty
  state lifts all three — a clear that left you parked on a tab you never chose would look
  broken. A section left empty by a filter disappears instead of showing a heading over nothing
- **The filter icon is Veg / Non-veg / Any, because that is the one property every item has**
  (`is_veg`). An item whose owner never said either way shows under Any and neither of the
  others — it is not guessed into one. Not offered, for the usual reason: spice level, price
  band, allergens and "popular" — there is no data behind any of them
- **Tab icons are a hint from the category's name, never a dish illustration.** The reference
  showed a flat illustration per dish; the owner names categories freely, so a burger icon on a
  category called "Rolls" would sometimes be wrong. `categoryIcon.js` matches keywords and falls
  back to the plain fork and knife rather than guess. Only the tabs and section headings carry
  one, and always beside the label
- **Every control keeps the name the tests and screen readers already knew** — `Add Masala
  Chai`, `Increase quantity of …`, `Back to menu`. The "+" is an icon with an `aria-label`, and
  Tailwind's text-free buttons (X, minus) keep theirs
- **Loading it costs the customer only this.** It is a separate chunk, so the dashboard's and
  the landing page's Tailwind never reach a phone at a table, and this one never reaches them

#### Order status on the customer's phone

- **The one line is the point, the four-step bar is the reassurance.** A tinted sentence says
  where the order is; under it Placed → Accepted → Preparing → Ready fills in red. The colours
  are status colours, not the brand: neutral while waiting, amber while being prepared, green
  when ready or served, red only for cancelled. The bill shows the sentence alone — its
  cancelled orders already carry a "not charged" badge, and saying it twice would be noise
- **It leads with the counter, not the kitchen.** Until the counter accepts a QR order nobody is
  cooking it, so "Waiting for the counter to accept your order" is the first thing said. The
  confirmation used to say "the kitchen has your order", which was untrue for that stretch
- **"Ready" is worded by the café's service mode** — "on its way to your table" or "please
  collect it from the counter" — because promising a delivery nobody makes is worse than saying
  nothing. It is a setting in Settings → Restaurant profile, defaulting to table service
- **No estimate, ever.** Nothing records how long anything takes, and a wrong "8 min" is worse
  than none. The text is `aria-live="polite"`: it changes while someone is looking at their
  phone's other half, and a screen reader should hear that it did

### The landing page (`/`)

Not part of this dashboard, but it borrows this system's language on purpose — white,
charcoal, one teal accent — because the person reading it is an owner deciding whether to
trust this with their service, and the calm version of that page is the persuasive one. The
customer app's warm palette was tried first and read as a food blog rather than a tool.

- **The software is the hero image.** `ProductMockups.jsx` draws the board, the POS order
  panel, the floor, the seating plan, the dashboard and the customer's phone in this
  system's own components and status colours, rather than showing a photograph of people
  eating. Seven of them, because the page has to sell the till and the day's numbers as
  well as the QR code — the first version led with QR ordering alone and read as if that
  were the whole product. They are mockups, not screenshots, because a
  screenshot of the live café would carry a real café's orders — and the frames are sized so
  real screenshots can drop straight in
- **Motion is decoration and must fail open.** Sections fade up as you reach them, but the
  hook re-checks position on scroll rather than trusting one IntersectionObserver callback:
  an observer reports only a *change* in intersection, so a section that is jumped past can
  be left at `opacity: 0` with real content inside it. It also skips itself entirely under
  `prefers-reduced-motion`. A decoration that can hide the page is not a decoration
- **Every anchor has a target, and a test walks them.** "The buttons don't work" turned out
  to mean "nothing responds when I press them" — the links all resolved. Hover, press
  (`active:scale-[0.98]`) and a nav border that appears once you leave the top are what
  fixed it

### Recent

Orders the kitchen is done with, read a day at a time. The one screen here that is a **table**
rather than cards, because the question is comparative — thirty finished orders scanned for the
one that explains a till that doesn't balance:

- **Rows are `<button>`s on a CSS grid, not a `<table>`.** A row has to be clickable (it opens
  the same detail drawer the board uses) and a table row cannot be a button. This way the whole
  row is one tab stop and its own text reads out in column order; the column labels above are
  `aria-hidden`, a scanning aid for the eye rather than a second thing to hear
- **The row stays one line.** Items truncate rather than wrapping — the drawer has the full
  list, and a grid where some rows are twice as tall stops being scannable
- **Columns are sized to fit a 1024px laptop** once the sidebar has taken its `w-64`. The first
  draft pushed **amount** off the right edge there, which is the worst column to lose: nobody
  scrolls sideways to look for it, they conclude it isn't shown. Found by looking at it at that
  width, not by a test
- **All / Served / Cancelled, and All is the default.** A cancelled order sitting between two
  served ones is exactly what "why doesn't the till match" is looking for, so a default that
  split them would hide the thing being looked for. The active filter is a **solid fill in its
  own status hue** — selection is always solid here, and the hue still says which status
- **"Unpaid" is amber and only appears on a served order.** A cancelled one gets an em dash:
  nothing is owed on an order that never happened, and "Unpaid" beside it would read as money
  someone still has to collect
- Taken from the reference: the day tabs, the status pills, the search field, the column set.
  **Not taken**: its Clock In button (no schema, same rule as the menu's AI descriptions) and
  its blue

### Create your café

The first screen a new owner sees, and the only one in this system that stands alone rather
than inside the dashboard shell. It is the Settings card pattern doing double duty — header
strip, fields, actions pinned to a footer strip — because it *is* a settings form, just one
filled in before there is anything to settle into.

- **It asks how many tables**, and places them. A first open that is an empty grid and an
  "Add table" button makes the owner do setup; one that is already a room makes them
  arrange it. Same reasoning the layout migration used when it placed every existing table
  rather than leaving them unplaced
- The note about what happens to those tables sits **grouped with the tables field**, not
  loose in the column — a hint at full width between two fields reads as a preamble to the
  wrong one
- **Sign out sits in the footer beside Create**, not hidden. Someone who signed in on the
  wrong account should not have to create a café to get out of this screen
- The menu is not seeded. Tables are generic and dishes are not, and example dishes in a
  real café's records are the same fake capability as a status nothing records

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

The owner brought a second reference (a POS called DineFlow) and asked for BurpnBill to look like
it. What that turned into, as a record of how this rule gets applied in practice:

**Taken** (structure and emphasis): a solid-filled active nav item; a brand monogram beside the
wordmark; an at-a-glance count strip over the floor map ("2 Occupied / 4 Free"); richer table
cards that show the live order, not just a status word; two-letter monograms on item cards; a
filled header bar on the cart panel; a boxed total above the CTA; and — most importantly —
much heavier type and stronger contrast throughout.

**Not taken**: its blue (we keep teal, for the reason above); its per-category pastel item-card
tints (see "what color is *not* for"); and every feature BurpnBill doesn't have — Waitlist, Merge
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

**A file input's visible label may not be its accessible name.** The photo box in
`ItemForm.jsx` swaps between a drop zone ("Click to add a photo") and a preview with a
"Replace" label, so the input's name changed with its state and a heading above it is a
`<span>`, not a `<label>`. It carries its own `aria-label="Item photo"` for that reason.

**A modal `<dialog>` also needs `m-auto`.** Tailwind's preflight sets `margin: 0` on every
element, which overrides the `margin: auto` the browser uses to centre a `showModal()` dialog —
without it the panel sticks to the top-left corner of the viewport. Same root cause as the
background above: the reset takes something the UA was providing for free.

## Color

*Superseded by "The BurpnBill brand system" at the top of this file; kept for the reasoning.*

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

**It happened a second time, and the fix that time was to delete the cause.** The landing
page at `/` is customer-side, and `styles.css` also dressed the customer app's own furniture
with *bare element* rules: `main` took padding, `section` took padding-top, and `section h2`
was the menu's category heading — small, grey, uppercase, letter-spaced. The landing page
uses those same elements, so every one of its section headings came out shouting. A cascade
layer is no help there, since the page lives inside that stylesheet's own world rather than
a foreign design system. Out-specifying each property would have worked and would have had
to be repeated by the next surface, so those three rules are now **scoped to `.app`**, the
customer screens' own wrapper. `.message` and `.confirmation` set their own padding, so
nothing outside `.app` ever depended on them. **The rule to take from both incidents: a bare
element selector in `styles.css` reaches every surface this repo has. Scope it to the app it
belongs to.**

The original fix was to wrap those element rules in `@layer bnb-customer` (a no-op for the customer
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

*Superseded by "The BurpnBill brand system" at the top of this file; kept for the reasoning.*

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

*Superseded by "The BurpnBill brand system" at the top of this file; kept for the reasoning.*

- Radius: `rounded-xl` (buttons, inputs, small cards), `rounded-2xl` (item/table cards),
  `rounded-full` (pills, badges, avatars)
- Elevation: `shadow-sm` at rest on interactive cards, `hover:shadow-md` — never more than
  that; this isn't a marketing page
- Borders stay thin (`border`, i.e. 1px) and light (`border-gray-200`) — no heavy dividers
- Panel padding: `p-4` standard, `p-6` for a page-level header
- Grid gaps: `gap-3` (dense card grids), `gap-4` (looser layouts)

## Layout pattern

*Superseded by "The BurpnBill brand system" at the top of this file; kept for the reasoning.*

- **Sidebar**: fixed width (`w-64`), a brand mark at top (teal rounded-square monogram + the
  wordmark), vertical nav (icon + label, active = solid `bg-teal-600 text-white`), and the
  **café** pinned to the bottom in its own `bg-gray-50 rounded-2xl` block — its name and
  initial, not the signed-in person's. What that corner answers is "which café am I looking
  at", which is what every number on every tab is scoped to; on a shared till it is also the
  question with a wrong answer worth catching. Who is signed in lives in Settings → User
  account, which is the only place it can be changed anyway. The name wraps to two lines
  rather than being cut down to something unrecognisable, and a rename in Settings updates it
  without a reload (the name rides on `GET /me`, so nothing fetches it twice). Doesn't yet collapse for
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
