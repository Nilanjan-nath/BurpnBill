import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logo } from './Logo.jsx';
import { StatusPill } from './StatusPill.jsx';
import LandingPage from '../landing/LandingPage.jsx';

// The BurpnBill brand system (docs/design.md) is worth pinning down in tests
// for the same reason the landing page's honesty claims are: it is easy to
// drift from, and nothing else here would notice. Three things are checked —
// the tokens really are legible, the surfaces really do use them, and the
// mark is the mark.

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '..');
const tokens = fs.readFileSync(path.join(here, 'tokens.css'), 'utf8');

const token = (name) => {
  const m = tokens.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`no --color-${name} in tokens.css`);
  return m[1];
};

// WCAG 2.x relative luminance and contrast ratio.
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('the brand tokens', () => {
  test('are the colours the logo and the brand system name', () => {
    expect(token('brand-600').toLowerCase()).toBe('#a70045'); // the logo's crimson
    expect(token('butter-300').toLowerCase()).toBe('#f4f0a9'); // the logo's butter
    expect(token('canvas').toLowerCase()).toBe('#fffcf0');
    expect(token('ink-900').toLowerCase()).toBe('#1e1418');
    expect(token('danger-500').toLowerCase()).toBe('#d92d20');
    // Danger and the brand must never blur.
    expect(token('danger-500').toLowerCase()).not.toBe(token('brand-600').toLowerCase());
  });

  test.each(['placed', 'prep', 'ready', 'served', 'cancelled'])('status pair "%s" is legible (AA, 4.5:1)', (name) => {
    expect(contrast(token(name), token(`${name}-ink`))).toBeGreaterThanOrEqual(4.5);
  });

  test('text on the ground, and white on crimson, are legible', () => {
    expect(contrast(token('ink-900'), token('canvas'))).toBeGreaterThanOrEqual(14); // brand: 15:1
    // (The brand sheet quotes 8.6:1; measured it is 7.7:1 — still AAA.)
    expect(contrast('#ffffff', token('brand-600'))).toBeGreaterThanOrEqual(7);
    // The lightest text the dashboard is allowed to use, on white and on canvas.
    expect(contrast(token('ink-500'), token('paper'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('ink-500'), token('canvas'))).toBeGreaterThanOrEqual(4.5);
    // Sidebar: nav text on the dark ink rail, and the butter wordmark on it.
    expect(contrast(token('ink-300'), token('ink-900'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('butter-300'), token('ink-900'))).toBeGreaterThanOrEqual(4.5);
    // Butter buttons carry ink text.
    expect(contrast(token('ink-900'), token('butter-300'))).toBeGreaterThanOrEqual(4.5);
    // Danger text on its own tint.
    expect(contrast(token('danger-700'), token('danger-50'))).toBeGreaterThanOrEqual(4.5);
    // White on the destructive button.
    expect(contrast('#ffffff', token('danger-500'))).toBeGreaterThanOrEqual(4.5);
  });
});

// Every surface that takes the brand system, listed by directory. The customer
// app (components/, customer/) deliberately does not and is not scanned.
const BRANDED = ['staff', 'landing'];
const sources = BRANDED.flatMap((dir) =>
  fs
    .readdirSync(path.join(src, dir))
    .filter((f) => /\.(jsx?|css)$/.test(f) && !/\.test\./.test(f))
    .map((f) => ({ file: `${dir}/${f}`, text: fs.readFileSync(path.join(src, dir, f), 'utf8') })),
);

describe('the branded surfaces', () => {
  test('use the brand tokens, not Tailwind\'s default palette', () => {
    // A `teal-600` or `gray-500` that creeps back in is the dashboard quietly
    // going off-brand, one class at a time.
    const stray = /(?<![\w-])(?:[a-z-]+:)*(?:bg|text|border|ring|from|via|to|divide|outline|shadow|fill|stroke|accent|placeholder|decoration)-(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;
    const found = sources.flatMap(({ file, text }) => (text.match(stray) ?? []).map((m) => `${file}: ${m}`));
    expect(found).toEqual([]);
  });

  test('never hard-code a hex colour into a class (except the customer phone mockup)', () => {
    const hex = /(?:bg|text|border|ring|from|to|fill|stroke)-\[#[0-9a-fA-F]{3,8}\]/g;
    const found = sources
      .filter(({ file }) => file !== 'landing/ProductMockups.jsx')
      .flatMap(({ file, text }) => (text.match(hex) ?? []).map((m) => `${file}: ${m}`));
    expect(found).toEqual([]);
    // The one allowed use is the customer app's own red, drawn on purpose.
    const mock = sources.find(({ file }) => file === 'landing/ProductMockups.jsx').text;
    const hexes = new Set(mock.match(hex) ?? []);
    expect([...hexes]).toEqual(['bg-[#dc2626]']);
  });

  test('carry the new name, and nothing of the old one — anywhere in the web app', () => {
    // Every source file, the customer app included: the rename is finished, so a
    // "Petuk" (or a `petuk.` storage key) creeping back in is a regression.
    const walk = (dir) =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return e.name === 'test' ? [] : walk(full);
        return /\.(jsx?|css)$/.test(e.name) && !/\.test\./.test(e.name) ? [full] : [];
      });
    const old = walk(src).flatMap((file) =>
      fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => /petuk/i.test(l))
        .map((l) => `${path.relative(src, file)}: ${l.trim()}`),
    );
    expect(old).toEqual([]);
    expect(fs.readFileSync(path.join(src, '..', 'index.html'), 'utf8')).toMatch(/<title>BurpnBill/);
  });

  test('load the brand fonts here and nowhere near the customer app', () => {
    expect(tokens).toMatch(/@fontsource-variable\/bricolage-grotesque/);
    expect(tokens).toMatch(/@fontsource-variable\/manrope/);
    expect(tokens).toMatch(/@fontsource-variable\/jetbrains-mono/);
    const customer = fs.readFileSync(path.join(src, 'customer/tailwind.css'), 'utf8') + fs.readFileSync(path.join(src, 'styles.css'), 'utf8');
    expect(customer).not.toMatch(/brand\/tokens|fontsource/);
  });
});

describe('the logo', () => {
  test('is the supplied mark, named for screen readers', () => {
    render(<Logo />);
    const mark = screen.getByRole('img', { name: 'BurpnBill' });
    expect(mark).toHaveAttribute('viewBox', '0 0 78.75 30.750001');
    // 13 filled shapes: the word's letters and marks — no more, no fewer.
    expect(mark.querySelectorAll('rect[fill="#A70045"]')).toHaveLength(13);
  });

  test.each([
    ['white', '#A70045', 'none'],
    ['cream', '#A70045', '#F4F0A9'],
    ['crimson', '#FFFFFF', 'none'],
    ['ink', '#F4F0A9', 'none'],
  ])('the "%s" colourway paints letters %s on %s, and nothing else', (variant, ink, ground) => {
    render(<Logo variant={variant} />);
    const mark = screen.getByRole('img', { name: 'BurpnBill' });
    const fills = new Set([...mark.querySelectorAll('[fill]')].map((el) => el.getAttribute('fill')));
    expect(fills).toEqual(new Set([ink, ground]));
  });

  test('two on one page do not share clip-path ids', () => {
    render(
      <>
        <Logo />
        <Logo variant="ink" />
      </>,
    );
    const ids = [...document.querySelectorAll('svg [id]')].map((el) => el.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the status pill', () => {
  test('always says the word, not just the colour', () => {
    render(<StatusPill status="preparing" />);
    expect(screen.getByText('Preparing')).toBeInTheDocument();
  });

  test('draws Cancelled struck through and muted, never in danger red', () => {
    render(<StatusPill status="cancelled" />);
    const pill = screen.getByText('Cancelled');
    expect(pill.className).toMatch(/line-through/);
    expect(pill.className).not.toMatch(/danger/);
  });
});

describe('the landing page', () => {
  test('wears the wordmark in the nav and the footer', async () => {
    render(<LandingPage />);
    expect(screen.getAllByRole('img', { name: 'BurpnBill' }).length).toBeGreaterThanOrEqual(3); // nav, closing band, footer
    expect(document.title).toMatch(/BurpnBill/);
    expect(document.body.textContent).not.toMatch(/petuk/i);
  });
});
