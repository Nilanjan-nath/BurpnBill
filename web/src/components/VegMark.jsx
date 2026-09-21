// The Indian food-labelling mark: a green dot in a green square for vegetarian,
// a red one for non-vegetarian. Unknown (null) shows nothing rather than guessing.
export function VegMark({ isVeg }) {
  if (isVeg === null || isVeg === undefined) return null;
  const label = isVeg ? 'Vegetarian' : 'Non-vegetarian';
  return (
    <span className={`veg-mark ${isVeg ? 'veg' : 'nonveg'}`} role="img" aria-label={label} title={label}>
      <span />
    </span>
  );
}
