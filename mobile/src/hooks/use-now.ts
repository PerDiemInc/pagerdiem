import { useEffect, useState } from 'react';

/** The current time, updated every `everyMs`, for timers and "time left" lines. */
export function useNow(everyMs: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
