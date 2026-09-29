import { useEffect, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Check,
  ChefHat,
  ClipboardList,
  CreditCard,
  LayoutGrid,
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
import { useReveal } from './useReveal.js';
import './landing-tailwind.css';

// The page at /. Lazy-loaded (see App.jsx), so a customer scanning a table's QR
// code downloads neither this nor the dashboard — verified in a production
// build, where this is its own chunk.
//
// It is a B2B page and wears the DASHBOARD's language, not the customer app's:
// white, charcoal, one teal accent held back for the things you can act on. The
// reader is a café owner deciding whether to trust this with their service, and
// the calm version of that page is the persuasive one.
//
// What is deliberately NOT here, and what a test will fail over if it comes
// back: a "trusted by N cafés" count, years in business, an uptime figure,
// invented testimonials, or a "free trial" with a clock nobody is running.
// There is one café live and it is the owner's own. Claiming otherwise on the
// first page anyone sees is the same fake capability as a floor-plan state
// nothing records.

const CTA = '/staff';

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
      className={`inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-6 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-teal-700 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 active:scale-[0.98] ${className}`}
    >
      {children}
    </a>
  );
}

function Eyebrow({ children }) {
  return <p className="text-sm font-semibold uppercase tracking-wider text-teal-700">{children}</p>;
}

export default function LandingPage() {
  // The bar earns its border only once you have left the top, so the hero opens
  // without a line ruled across it.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="lp min-h-dvh bg-white text-gray-900 antialiased">
      <header
        className={`sticky top-0 z-30 transition-colors duration-200 ${
          scrolled ? 'border-b border-gray-200 bg-white/85 backdrop-blur' : 'border-b border-transparent bg-white'
        }`}
      >
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-3.5 sm:px-8">
          <a href="#top" className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-gray-900">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600 text-sm font-bold text-white"
              aria-hidden="true"
            >
              P
            </span>
            Petuk
          </a>
          <nav className="ml-4 hidden items-center gap-6 md:flex" aria-label="Sections">
            {NAV.map(([href, label]) => (
              <a key={href} href={href} className="text-sm font-semibold text-gray-600 transition-colors hover:text-gray-900">
                {label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1 sm:gap-3">
            <a
              href={CTA}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-gray-700 transition-colors hover:text-gray-900"
            >
              Sign in
            </a>
            <a
              href={CTA}
              className="rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 hover:shadow-md active:scale-[0.98]"
            >
              Start free
            </a>
          </div>
        </div>
      </header>

      <main id="top">
        {/* Hero ------------------------------------------------------------ */}
        <div className="relative overflow-hidden">
          {/* Understated and behind everything: one soft wash, so the hero is
              not a flat white rectangle. */}
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-[560px] bg-gradient-to-b from-teal-50 via-white to-white"
            aria-hidden="true"
          />
          <div className="relative mx-auto max-w-6xl px-5 pb-16 pt-14 sm:px-8 sm:pb-24 sm:pt-20">
            <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-white px-3 py-1 text-xs font-semibold text-teal-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-teal-500" aria-hidden="true" />
                  QR ordering for cafés and small restaurants
                </span>
                <h1 className="mt-5 text-4xl font-bold leading-[1.08] tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
                  Your staff can’t reach every table at 7pm.
                  <span className="block text-teal-700">The tables can order themselves.</span>
                </h1>
                <p className="mt-6 max-w-xl text-lg leading-relaxed text-gray-600">
                  Put a QR code on every table. Customers read your live menu and order from their own phone. The
                  order waits at your counter for you to accept, then goes straight to the kitchen board — and you
                  take the money the way you always have.
                </p>
                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <PrimaryCta>
                    Start free <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </PrimaryCta>
                  <a
                    href="#how"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-gray-300 px-5 py-3.5 text-base font-semibold text-gray-700 transition hover:border-gray-400 hover:bg-gray-50 active:scale-[0.98]"
                  >
                    See how it works
                  </a>
                </div>
                <p className="mt-5 text-sm font-medium text-gray-500">
                  Free while we’re in beta. No card, no commission, no payment gateway to sign up for.
                </p>
              </div>

              <div className="lg:pl-4">
                <KitchenBoardMock />
              </div>
            </div>
          </div>
        </div>

        {/* An honest strip. One café is live and it is the owner's own, so it
            says that rather than inventing a wall of logos. ---------------- */}
        <div className="border-y border-gray-200 bg-gray-50">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-5 py-5 text-center sm:px-8">
            <p className="text-sm font-semibold text-gray-600">Built in Tripura, for cafés in towns like it</p>
            <span className="hidden h-4 w-px bg-gray-300 sm:block" aria-hidden="true" />
            <p className="text-sm font-semibold text-gray-600">Running live in its first café</p>
            <span className="hidden h-4 w-px bg-gray-300 sm:block" aria-hidden="true" />
            <p className="text-sm font-semibold text-gray-600">Built with owners, not for a pitch deck</p>
          </div>
        </div>

        {/* Problems -------------------------------------------------------- */}
        <Reveal className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
          <Eyebrow>The actual problem</Eyebrow>
          <h2 className="mt-3 max-w-2xl text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            Service doesn’t break because of software. It breaks because nobody could get to table nine.
          </h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {PAINS.map(({ Icon, title, body }) => (
              <div
                key={title}
                className="rounded-2xl border border-gray-200 bg-white p-6 transition hover:border-gray-300 hover:shadow-md"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-base font-bold text-gray-900">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{body}</p>
              </div>
            ))}
          </div>
        </Reveal>

        {/* Features -------------------------------------------------------- */}
        <div id="features" className="border-t border-gray-200 bg-gray-50">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
            <Eyebrow>What you get</Eyebrow>
            <h2 className="mt-3 max-w-2xl text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              One tool for the table, the till and the kitchen
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-gray-600">
              QR ordering is where it starts, not where it stops. The same system rings up walk-ins at the counter,
              runs the kitchen board, holds your floor plan, and adds up the day.
            </p>

            <div className="mt-16 space-y-20 sm:space-y-24">
              {FEATURES.map(({ eyebrow, title, body, points, Mock }, i) => (
                <Reveal key={title} className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
                  <div className={i % 2 === 1 ? 'lg:order-2' : ''}>
                    <Eyebrow>{eyebrow}</Eyebrow>
                    <h3 className="mt-3 text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">{title}</h3>
                    <p className="mt-4 text-base leading-relaxed text-gray-600">{body}</p>
                    <ul className="mt-6 space-y-3">
                      {points.map((point) => (
                        <li key={point} className="flex items-start gap-3 text-sm font-medium text-gray-700">
                          <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-teal-50 text-teal-700">
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

            <div className="mt-20 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {ALSO.map(({ Icon, title, body }) => (
                <div key={title} className="rounded-2xl border border-gray-200 bg-white p-5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <h3 className="mt-3 text-sm font-bold text-gray-900">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-gray-600">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* How it works ---------------------------------------------------- */}
        <Reveal id="how" className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            Four steps, and one of them is you
          </h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(({ Icon, title, body }, i) => (
              <div key={title} className="rounded-2xl border border-gray-200 bg-white p-6">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-600 text-white">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <p className="mt-4 text-xs font-bold uppercase tracking-wider text-gray-400">Step {i + 1}</p>
                <h3 className="mt-1 text-lg font-bold text-gray-900">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{body}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 rounded-xl border border-teal-200 bg-teal-50 px-5 py-4 text-sm font-semibold text-teal-900">
            Step three is the one most systems skip. A QR code can be scanned by anyone who kept the link, so nothing
            reaches your kitchen until someone behind the counter says yes.
          </p>
        </Reveal>

        {/* Pricing --------------------------------------------------------- */}
        <div id="pricing" className="border-t border-gray-200 bg-gray-50">
          <Reveal className="mx-auto max-w-4xl px-5 py-20 sm:px-8 sm:py-24">
            <div className="text-center">
              <Eyebrow>Pricing</Eyebrow>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
                Free while we’re in beta
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-gray-600">
                Petuk is new, and we would rather have cafés using it than money from them. There’s no card to enter
                and nothing to cancel. If we start charging, you’ll hear it from us first — not from your bank.
              </p>
            </div>
            <div className="mt-10 overflow-hidden rounded-2xl border border-gray-200 bg-white">
              <div className="border-b border-gray-200 p-8 text-center">
                <p className="text-sm font-semibold text-gray-600">Everything, for every café</p>
                <p className="mt-2 text-5xl font-bold tracking-tight text-gray-900">₹0</p>
                <p className="mt-2 text-sm font-medium text-gray-500">while we’re in beta</p>
                <PrimaryCta className="mt-6">
                  Create your café <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </PrimaryCta>
              </div>
              <ul className="grid gap-3 p-8 sm:grid-cols-2">
                {INCLUDED.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm font-medium text-gray-700">
                    <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-teal-50 text-teal-700">
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
          <h2 className="mt-3 max-w-2xl text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            The short list, before you find out on a Saturday
          </h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {LIMITS.map(([title, body]) => (
              <div key={title} className="rounded-2xl border border-gray-200 bg-white p-6">
                <h3 className="text-base font-bold text-gray-900">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{body}</p>
              </div>
            ))}
          </div>
        </Reveal>

        {/* Final CTA ------------------------------------------------------- */}
        <div className="bg-gray-900">
          <Reveal className="mx-auto max-w-3xl px-5 py-20 text-center sm:px-8 sm:py-24">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Set it up before tomorrow’s lunch
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-gray-300">
              Make an account, tell us your café’s name and how many tables you have, and they’ll be waiting on your
              floor plan. Add your menu, print the codes, start taking orders.
            </p>
            <a
              href={CTA}
              className="mt-8 inline-flex items-center justify-center gap-2 rounded-xl bg-white px-6 py-3.5 text-base font-semibold text-gray-900 shadow-sm transition hover:bg-gray-100 active:scale-[0.98]"
            >
              Create your café <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </a>
          </Reveal>
        </div>
      </main>

      <footer className="border-t border-gray-200 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div className="flex items-center gap-2.5 text-base font-bold text-gray-900">
              <span
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-600 text-xs font-bold text-white"
                aria-hidden="true"
              >
                P
              </span>
              Petuk
            </div>
            <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Footer">
              {[...NAV, [CTA, 'Sign in']].map(([href, label]) => (
                <a
                  key={label}
                  href={href}
                  className="text-sm font-medium text-gray-600 transition-colors hover:text-gray-900"
                >
                  {label}
                </a>
              ))}
            </nav>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-6">
            <p className="text-sm text-gray-500">QR table ordering for cafés and small restaurants.</p>
            {/* This page took over the address that used to tell a customer what
                to do, so the line they needed keeps a home down here. */}
            <p className="text-sm text-gray-500">
              Sitting in a café? Point your phone’s camera at the QR code on your table — nothing to install.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
