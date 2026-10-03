import { useCallback, useEffect, useState } from 'react';
import { StaffApiError } from '../staff/staffApi.js';

// Load something from the API when a screen opens (and again whenever `key`
// changes), keeping the last answer on screen while the next one loads. Errors
// are the API's own message; anything that is not an API error is a bug and is
// rethrown, not swallowed.
export function useLoad(loader, key) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loader());
      setError(null);
    } catch (err) {
      if (!(err instanceof StaffApiError)) throw err;
      setError(err.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, error, loading, reload: load };
}
