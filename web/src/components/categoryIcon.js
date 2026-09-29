import {
  Coffee, Cookie, Croissant, IceCream, Pizza, Salad, Sandwich, Soup, Utensils, UtensilsCrossed,
} from 'lucide-react';

// A small icon for a category tab. The owner names categories freely, so this
// is a hint from the name and nothing more: anything unrecognised gets the
// plain fork and knife rather than a guess that could be wrong. It is only ever
// decoration beside a label, never the label itself.
const RULES = [
  [/pizza/i, Pizza],
  [/burger|sandwich|wrap|roll|sub\b/i, Sandwich],
  [/bever|drink|tea|chai|coffee|juice|shake|smoothie|lassi|soda|mocktail/i, Coffee],
  [/dessert|sweet|cake|brownie|ice|pastr/i, IceCream],
  [/bread|bakery|toast|bun/i, Croissant],
  [/soup|noodle|ramen|maggi/i, Soup],
  [/starter|appetis|salad|chaat/i, Salad],
  [/snack|bite|fries|finger|pakora|puff/i, Cookie],
  [/main|curry|meal|thali|rice|biryani|combo/i, UtensilsCrossed],
];

export function categoryIcon(name) {
  return RULES.find(([pattern]) => pattern.test(name))?.[1] ?? Utensils;
}
