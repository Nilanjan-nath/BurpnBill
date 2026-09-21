// − 2 +  Used in the item sheet (min 1) and in the cart (min 0 = remove the line).
export function Stepper({ value, onChange, name, min = 1, max = 99, disabled }) {
  const removes = min === 0 && value === 1;
  return (
    <div className="stepper">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={disabled || value <= min}
        aria-label={removes ? `Remove ${name}` : `Decrease quantity of ${name}`}
      >
        {removes ? '×' : '−'}
      </button>
      <span aria-live="polite" aria-label={`Quantity of ${name}`}>{value}</span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={disabled || value >= max}
        aria-label={`Increase quantity of ${name}`}
      >
        +
      </button>
    </div>
  );
}
