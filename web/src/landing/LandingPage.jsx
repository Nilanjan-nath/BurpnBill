import { useEffect, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  BellRing,
  Check,
  ChefHat,
  ClipboardList,
  CreditCard,
  LayoutGrid,
  Pause,
  Printer,
  QrCode,
  Receipt,
  Timer,
  Users,
  UtensilsCrossed,
} from 'lucide-react';
import {
  KitchenBoardMock,
  FloorPlanMock,
  MenuMock,
  PhoneMock,
  PosOrderMock,
  SeatingPlanMock,
  DashboardMock,
} from './ProductMockups.jsx';
import { Logo } from '../brand/Logo.jsx';
import { HeroStage, HeroStrip } from './HeroMotion.jsx';
import { useReveal } from './useReveal.js';
import './landing-tailwind.css';

// The page at /. Lazy-loaded (see App.jsx), so a customer scanning a table's QR
// code downloads neither this nor the dashboard — verified in a production
// build, where this is its own chunk.
//
// It is a B2B page and wears the BURPNBILL brand system (docs/design.md), the
// same one as the dashboard, not the customer app's: cream canvas, white
// cards, warm ink, and crimson held for the things you can act on. The hero is
// the one place the brand goes loud — a full crimson band, the way the brand
// system's own cover does it. The reader is a café owner deciding whether to
// trust this with their service, so everything below the hero stays calm.
//
// What is deliberately NOT here, and what a test will fail over if it comes
// back: a "trusted by N cafés" count, years in business, an uptime figure,
// invented testimonials, or a price. There is one café live and it is the
// owner's own, and no subscription exists yet, so the pricing section offers
// 14 days free and says plainly that the price is not set. (A trial WAS on this
// list until the owner chose one. Nothing in the product ends it at day 15 —
// restaurants.created_at says when each café's fortnight is up, and the owner
// honours it by hand. If that ever stops being true, this page must change.)
// Claiming otherwise on the first page anyone sees is the same fake capability
// as a floor-plan state nothing records.

const CTA = '/staff';

// The sticky bar's height (h-[4.5rem]); the hero sits under it, and the bar turns
// solid once the hero's bottom edge reaches it.
const NAV_HEIGHT = 72;

const PAINS = [
  {
    Icon: Timer,
    title: 'The 7pm rush',
    body: 'Four tables want to order at once and there is one of you. Orders arrive while you are still walking to the next table.',
  },
  {
    Icon: ClipboardList,
    title: 'Orders lost between pad and kitchen',
    body: 'No shouted order, no torn paper slip. What the customer tapped is exactly what the kitchen reads.',
  },
  {
    Icon: UtensilsCrossed,
    title: 'The dish that ran out at noon',
    body: '86 an item from your phone and it disappears from every table’s menu in the same second.',
  },
  {
    Icon: CreditCard,
    title: 'Bills that do not add up',
    body: 'Every table carries its running total. At checkout you see the itemised bill before you take a rupee.',
  },
];

const FEATURES = [
  {
    eyebrow: 'QR ordering',
    title: 'Your menu, on the table, without an app',
    body: 'Each table gets its own code. The customer scans, reads today’s menu with your photos and prices, and orders from where they are sitting. Nothing to download, no account to make.',
    points: ['Works with any phone camera', 'Prices and availability are always live', 'Notes per item, like “less sugar”'],
    Mock: PhoneMock,
  },
  {
    eyebrow: 'POS',
    title: 'Take orders at the counter too — no QR code needed',
    body: 'A walk-in orders at the till the way they always have. Pick the table, tap through the menu, send it to the kitchen. It lands on the same board as a QR order, so the kitchen never has to know where an order came from.',
    points: [
      'Ring up a walk-in without a QR code',
      'Table bills and checkout: cash, card or UPI',
      'Itemised bill before you take a rupee',
    ],
    Mock: PosOrderMock,
  },
  {
    eyebrow: 'The counter decides',
    title: 'Nothing reaches the kitchen until you accept it',
    body: 'A QR code can be scanned by anyone who has it. Orders queue at the till first, so you accept or turn one away before the kitchen ever sees it — the counter stays in charge of the room.',
    points: ['Accept or reject in one tap', 'Staff-placed orders skip the queue', 'Every decision recorded against a name'],
    Mock: FloorPlanMock,
  },
  {
    eyebrow: 'Live kitchen board',
    title: 'One screen the whole kitchen can read',
    body: 'New, preparing, ready. The table is the biggest thing on the card, because that is what gets called out. An order that has waited too long rings itself in amber, then red.',
    points: ['Updates the moment something changes', 'Ages measured on the server’s clock, not the tablet’s', 'Readable across a kitchen'],
    Mock: KitchenBoardMock,
  },
  {
    eyebrow: 'Your floor plan',
    title: 'Arrange the room the way it actually is',
    body: 'Drag your tables onto a grid until the screen matches the floor — or move them a square at a time with the arrow keys. The till draws from the same plan, so the person at the counter sees the room, not a list.',
    points: [
      'Set seats, rename, or pause a table for the evening',
      'Retire a table without erasing its past orders',
      'Print a QR sheet for the whole room',
    ],
    Mock: SeatingPlanMock,
  },
  {
    eyebrow: 'Today’s numbers',
    title: 'What you took, what’s still on tables, and when you were busy',
    body: 'Takings and money still owed are two figures, not one — the first is in the till, the second is sitting on tables. Underneath: sales by hour against the same time yesterday, how people paid, and what sold.',
    points: [
      'Sales by hour, so you can staff the rush',
      'Compared with the same time yesterday, not a finished day',
      'QR versus counter, and today’s best sellers',
    ],
    Mock: DashboardMock,
  },
  {
    eyebrow: 'Menu management',
    title: 'Change the menu in the time it takes to say it',
    body: 'Add a dish, put a photo on it, reorder your sections, or take something off. Categories are yours to name and order, and every change reaches the tables immediately.',
    points: ['Photos on your items and the customer menu', 'Sections in your order, not the alphabet’s', 'One tap to 86 something'],
    Mock: MenuMock,
  },
];

// The things that matter but do not need a screenshot each.
const ALSO = [
  { Icon: Users, title: 'Staff accounts and roles', body: 'Owner, front of house, kitchen. Invite by email; the kitchen never sees the till.' },
  { Icon: Receipt, title: 'Table bills', body: 'Every unpaid round on a table, grouped, with a running total the floor can see.' },
  { Icon: Printer, title: 'Printable QR sheets', body: 'Print the whole room’s codes at once, or download one table’s as SVG or PNG.' },
  { Icon: ClipboardList, title: 'Order history', body: 'Every served and cancelled order, by day, with who finished it and how it was paid.' },
  { Icon: LayoutGrid, title: 'Live order stream', body: 'The board updates itself. No refresh button, and it tells you if the connection drops.' },
  { Icon: BarChart3, title: 'Seven-day view', body: 'Last week at a glance, plus the payment mix from real payments, not estimates.' },
  // Worded to promise only what is true: the phone asks every 15–30 seconds, so
  // it is not "live", it has no time estimate, and it is only as current as the
  // kitchen's taps. The test below fails if a bigger claim creeps in.
  {
    Icon: BellRing,
    title: 'Customers see where their order is',
    body: 'Waiting for the counter, being prepared, ready — so guests stop flagging staff down to ask. You choose whether “ready” means brought to the table or collected at the counter.',
  },
  { Icon: Pause, title: 'Pause a table', body: 'Its QR code stops taking orders straight away and works again when you resume it. Nothing to reprint.' },
];

const STEPS = [
  { Icon: QrCode, title: 'Scan', body: 'The customer points their camera at the code on the table.' },
  { Icon: ClipboardList, title: 'Order', body: 'They browse the live menu and send the order from their phone.' },
  { Icon: Check, title: 'Accept', body: 'It waits at your counter. You accept it, or turn it away.' },
  { Icon: ChefHat, title: 'Cook and serve', body: 'The kitchen board picks it up live, and you settle at the counter.' },
];

const INCLUDED = [
  'Unlimited tables and QR codes',
  'Unlimited menu items and photos',
  'Live kitchen board and order history',
  'POS, table bills and checkout',
  'Staff accounts with roles',
  'Today’s takings and sales analytics',
];

const LIMITS = [
  [
    'No payment gateway',
    'You take cash, card or UPI at the counter as you do now. Checkout records which, and clears the table.',
  ],
  ['No tax engine', 'Prices are what you set. Nothing adds a percentage you did not ask for.'],
  ['No stock counts', 'An item is available or it is 86’d. One tap, from any phone on the floor.'],
  [
    'No waitlist or table timers',
    'Three table states, because three are all this can honestly know: free, occupied, paused.',
  ],
];

const NAV = [
  ['#features', 'Features'],
  ['#how', 'How it works'],
  ['#pricing', 'Pricing'],
  ['#limits', 'What it doesn’t do'],
];

function Reveal({ id, className = '', children }) {
  const [ref, shown] = useReveal();
  return (
    <section
      id={id}
      ref={ref}
      className={`transition duration-500 ease-out ${shown ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'} ${className}`}
    >
      {children}
    </section>
  );
}

function PrimaryCta({ children, className = '' }) {
  return (
    <a
      href={CTA}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-card bg-brand px-6 py-3 text-base font-bold text-white transition duration-150 ease-tap hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:scale-[0.98] ${className}`}
    >
      {children}
    </a>
  );
}

function Eyebrow({ children }) {
  return <p className="font-mono text-xs font-bold uppercase tracking-[0.12em] text-brand">{children}</p>;
}

export default function LandingPage() {
  // The bar earns its border only once you have left the top, so the hero opens
  // without a line ruled across it.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    // index.html's title belongs to the customer app, which shares the shell.
    document.title = 'BurpnBill — the table, the till and the kitchen';
  }, []);
  // The bar is part of the hero until you scroll past it: transparent over the
  // crimson, butter wordmark, white links — so the two read as one band — and
  // only then does it become the cream bar with a rule under it that stays with
  // you down the page.
  useEffect(() => {
    const onScroll = () => {
      const hero = document.getElementById('hero');
      const past = hero ? hero.offsetHeight - NAV_HEIGHT : 8;
      setScrolled(window.scrollY > past);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="lp brand-surface min-h-dvh bg-canvas text-ink-900 antialiased">
      {/* -mb pulls the hero up under the bar, so the crimson starts at the very top. */}
      <header
        className={`sticky top-0 z-30 -mb-[4.5rem] h-[4.5rem] transition-colors duration-200 ${
          scrolled ? 'border-b border-ink-200 bg-canvas/90 backdrop-blur' : 'border-b border-transparent bg-transparent'
        }`}
      >
        <div className="mx-auto flex h-full max-w-6xl items-center gap-4 px-5 sm:px-8">
          <a href="#top" aria-label="BurpnBill, back to the top" className="flex-none">
            <Logo variant={scrolled ? 'white' : 'ink'} width={112} />
          </a>
          <nav className="ml-4 hidden items-center gap-6 md:flex" aria-label="Sections">
            {NAV.map(([href, label]) => (
              <a
                key={href}
                href={href}
                className={`text-sm font-bold transition-colors ${
                  scrolled ? 'text-ink-600 hover:text-ink-900' : 'text-white/85 hover:text-white'
                }`}
              >
                {label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1 sm:gap-3">
            <a
              href={CTA}
              className={`rounded-input px-3 py-2 text-sm font-bold transition-colors ${
                scrolled ? 'text-ink-700 hover:text-ink-900' : 'text-white hover:text-butter-300'
              }`}
            >
              Sign in
            </a>
            <a
              href={CTA}
              className={`rounded-card px-4 py-2.5 text-sm font-bold transition duration-150 ease-tap active:scale-[0.98] ${
                scrolled
                  ? 'bg-brand text-white hover:bg-brand-700'
                  : 'bg-butter-300 text-ink-900 hover:bg-butter-100'
              }`}
            >
              Start free
            </a>
          </div>
        </div>
      </header>

      <main id="top">
        {/* Hero ------------------------------------------------------------ */}
        {/* The brand cover, moving: a full crimson band with the 32px grid
            drifting under two soft blobs, the headline rising line by line, and
            a small scene on the right that plays an order's whole life (see
            HeroMotion.jsx — from the owner's motion template). Text on it is
            white or butter only. Everything below this band is unchanged. */}
        <div id="hero" className="hm-hero relative isolate flex min-h-dvh flex-col overflow-hidden bg-brand pt-[4.5rem] text-white">
          <div className="hm-grid" aria-hidden="true" />
          <i className="hm-blob hm-b1" aria-hidden="true" />
          <i className="hm-blob hm-b2" aria-hidden="true" />

          <div className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-8 px-5 py-12 sm:px-8 xl:grid-cols-[minmax(0,1fr)_540px] [&>*]:min-w-0">
            <div>
              <span className="hm-eye inline-flex items-center gap-2 rounded-full bg-butter-300/15 px-3.5 py-1 font-mono text-xs font-bold uppercase tracking-[0.08em] text-butter-300">
                <i className="h-2 w-2 rounded-full bg-butter-300" aria-hidden="true" />
                QR ordering + POS for cafés
              </span>
              <h1 className="hm-h1 mb-5 mt-5 text-[clamp(44px,6.6vw,84px)] font-extrabold leading-[0.98] tracking-[-0.035em] text-white">
                <span className="hm-l">
                  <span>Order fast.</span>
                </span>{' '}
                <span className="hm-l">
                  <span>Settle easy.</span>
                </span>
              </h1>
              <p className="hm-sub max-w-[46ch] text-lg leading-relaxed text-white/90 sm:text-[19px]">
                Guests scan, order and go. You approve, cook and settle from one live board. No app to download, no
                shouting across the room.
              </p>
              <div className="hm-cta mb-6 mt-7 flex flex-wrap items-center gap-3">
                <a
                  href={CTA}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-card border-2 border-butter-300 bg-butter-300 px-6 text-base font-bold text-ink-900 transition duration-150 ease-tap hover:-translate-y-0.5 hover:bg-butter-100 hover:shadow-pop focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:translate-y-0 active:scale-[0.98]"
                >
                  Start free <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </a>
                <a
                  href="#how"
                  className="inline-flex min-h-12 items-center justify-center gap-1.5 rounded-card border-2 border-butter-300 px-6 text-base font-bold text-butter-300 transition duration-150 ease-tap hover:-translate-y-0.5 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:translate-y-0 active:scale-[0.98]"
                >
                  See how it works
                </a>
              </div>
              <ul className="hm-chips flex flex-wrap gap-2 text-[13px]">
                {['No login for guests', 'You approve every QR order', 'Cash, card or UPI'].map((chip) => (
                  <li key={chip} className="rounded-full border border-butter-300/35 px-3.5 py-1.5 text-butter-300">
                    {chip}
                  </li>
                ))}
              </ul>
              <p className="hm-chips mt-4 text-sm font-semibold text-white/90">
                Free for 14 days. No card, no commission, no payment gateway to sign up for.
              </p>
            </div>

            <HeroStage />
          </div>

          <HeroStrip />
        </div>

        {/* An honest strip. One café is live and it is the owner's own, so it
            says that rather than inventing a wall of logos. ---------------- */}
        <div className="border-b border-ink-200 bg-paper">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-5 py-5 text-center sm:px-8">
            <p className="text-sm font-bold text-ink-600">Built in Tripura, for cafés in towns like it</p>
            <span className="hidden h-4 w-px bg-ink-300 sm:block" aria-hidden="true" />
            <p className="text-sm font-bold text-ink-600">Running live in its first café</p>
            <span className="hidden h-4 w-px bg-ink-300 sm:block" aria-hidden="true" />
            <p className="text-sm font-bold text-ink-600">Built with owners, not for a pitch deck</p>
          </div>
        </div>

        {/* Problems -------------------------------------------------------- */}
        <Reveal className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
          <Eyebrow>The actual problem</Eyebrow>
          <h2 className="mt-3 max-w-2xl text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
            Service doesn’t break because of software. It breaks because nobody could get to table nine.
          </h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {PAINS.map(({ Icon, title, body }) => (
              <div
                key={title}
                className="rounded-card border border-ink-200 bg-paper p-6 transition hover:border-ink-300"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-card bg-brand-50 text-brand">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-base font-bold text-ink-900">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{body}</p>
              </div>
            ))}
          </div>
        </Reveal>

        {/* Features -------------------------------------------------------- */}
        <div id="features" className="border-t border-ink-200 bg-paper">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
            <Eyebrow>What you get</Eyebrow>
            <h2 className="mt-3 max-w-2xl text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
              One tool for the table, the till and the kitchen
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-600">
              QR ordering is where it starts, not where it stops. The same system rings up walk-ins at the counter,
              runs the kitchen board, holds your floor plan, and adds up the day.
            </p>

            <div className="mt-16 space-y-20 sm:space-y-24">
              {FEATURES.map(({ eyebrow, title, body, points, Mock }, i) => (
                <Reveal key={title} className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
                  <div className={i % 2 === 1 ? 'lg:order-2' : ''}>
                    <Eyebrow>{eyebrow}</Eyebrow>
                    <h3 className="mt-3 text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">{title}</h3>
                    <p className="mt-4 text-base leading-relaxed text-ink-600">{body}</p>
                    <ul className="mt-6 space-y-3">
                      {points.map((point) => (
                        <li key={point} className="flex items-start gap-3 text-sm font-medium text-ink-700">
                          <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-brand-50 text-brand">
                            <Check className="h-3 w-3" aria-hidden="true" />
                          </span>
                          {point}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className={i % 2 === 1 ? 'lg:order-1' : ''}>
                    <Mock />
                  </div>
                </Reveal>
              ))}
            </div>

            <div className="mt-20 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {ALSO.map(({ Icon, title, body }) => (
                <div key={title} className="rounded-card border border-ink-200 bg-canvas p-5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-input bg-brand-50 text-brand">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <h3 className="mt-3 text-sm font-bold text-ink-900">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* How it works ---------------------------------------------------- */}
        <Reveal id="how" className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
            Four steps, and one of them is you
          </h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(({ Icon, title, body }, i) => (
              <div key={title} className="rounded-card border border-ink-200 bg-paper p-6">
                <span className="flex h-11 w-11 items-center justify-center rounded-card bg-brand text-white">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <p className="mt-4 text-xs font-bold uppercase tracking-wider text-ink-500">Step {i + 1}</p>
                <h3 className="mt-1 text-lg font-bold text-ink-900">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{body}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 rounded-card border border-butter-500 bg-butter-100 px-5 py-4 text-sm font-semibold text-ink-900">
            Step three is the one most systems skip. A QR code can be scanned by anyone who kept the link, so nothing
            reaches your kitchen until someone behind the counter says yes.
          </p>
        </Reveal>

        {/* Pricing --------------------------------------------------------- */}
        <div id="pricing" className="border-t border-ink-200 bg-paper">
          <Reveal className="mx-auto max-w-4xl px-5 py-20 sm:px-8 sm:py-24">
            <div className="text-center">
              <Eyebrow>Pricing</Eyebrow>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
                Try it in your café before you decide
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-ink-600">
                Everything is switched on from the first day, and there’s no card to enter. We haven’t set a price
                yet, and we would rather work it out with the first cafés than guess — you’ll hear what it is from
                us, before it costs you anything.
              </p>
            </div>
            <div className="mt-10 overflow-hidden rounded-card border border-ink-200 bg-canvas">
              <div className="border-b border-ink-200 p-8 text-center">
                <p className="text-sm font-semibold text-ink-600">Everything, for every café</p>
                <p className="mt-2 font-display text-5xl font-extrabold tracking-tight text-ink-900">14 days</p>
                <p className="mt-2 text-sm font-medium text-ink-500">free, nothing held back</p>
                <PrimaryCta className="mt-6">
                  Create your café <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </PrimaryCta>
              </div>
              <ul className="grid gap-3 p-8 sm:grid-cols-2">
                {INCLUDED.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm font-medium text-ink-700">
                    <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-brand-50 text-brand">
                      <Check className="h-3 w-3" aria-hidden="true" />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>

        {/* What it doesn't do ---------------------------------------------- */}
        <Reveal id="limits" className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
          <Eyebrow>What it doesn’t do</Eyebrow>
          <h2 className="mt-3 max-w-2xl text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
            The short list, before you find out on a Saturday
          </h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {LIMITS.map(([title, body]) => (
              <div key={title} className="rounded-card border border-ink-200 bg-paper p-6">
                <h3 className="text-base font-bold text-ink-900">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{body}</p>
              </div>
            ))}
          </div>
        </Reveal>

        {/* Final CTA ------------------------------------------------------- */}
        <div className="bg-ink-900">
          <Reveal className="mx-auto max-w-3xl px-5 py-20 text-center sm:px-8 sm:py-24">
            <Logo variant="ink" width={144} className="mx-auto mb-8" />
            <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              Set it up before tomorrow’s lunch
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-ink-300">
              Make an account, tell us your café’s name and how many tables you have, and they’ll be waiting on your
              floor plan. Add your menu, print the codes, start taking orders.
            </p>
            <a
              href={CTA}
              className="mt-8 inline-flex min-h-12 items-center justify-center gap-2 rounded-card bg-butter-300 px-6 py-3 text-base font-bold text-ink-900 transition duration-150 ease-tap hover:bg-butter-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-butter-300 active:scale-[0.98]"
            >
              Create your café <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </a>
          </Reveal>
        </div>
      </main>

      <footer className="border-t border-ink-200 bg-paper">
        <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <Logo variant="white" width={104} />
            <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Footer">
              {[...NAV, [CTA, 'Sign in']].map(([href, label]) => (
                <a
                  key={label}
                  href={href}
                  className="text-sm font-medium text-ink-600 transition-colors hover:text-ink-900"
                >
                  {label}
                </a>
              ))}
            </nav>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-ink-200 pt-6">
            <p className="text-sm text-ink-500">QR table ordering for cafés and small restaurants.</p>
            {/* This page took over the address that used to tell a customer what
                to do, so the line they needed keeps a home down here. */}
            <p className="text-sm text-ink-500">
              Sitting in a café? Point your phone’s camera at the QR code on your table — nothing to install.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
