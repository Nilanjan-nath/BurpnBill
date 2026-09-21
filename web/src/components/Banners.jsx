// `notice` is information (your session was reset); `problem` is something the
// last action couldn't do. Both are dismissible and announced to screen readers.
export function Banners({ notice, problem, onDismissNotice, onDismissProblem }) {
  return (
    <>
      {notice && (
        <div className="banner info" role="status">
          <span>{notice}</span>
          <button type="button" onClick={onDismissNotice} aria-label="Dismiss message">×</button>
        </div>
      )}
      {problem && (
        <div className="banner error" role="alert">
          <span>{problem}</span>
          <button type="button" onClick={onDismissProblem} aria-label="Dismiss message">×</button>
        </div>
      )}
    </>
  );
}
