// Full-screen message for the states where there is no menu to show.
export function Message({ title, children, action }) {
  return (
    <main className="message">
      <h1>{title}</h1>
      <p>{children}</p>
      {action && (
        <button type="button" className="primary" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </main>
  );
}
