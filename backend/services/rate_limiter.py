"""
Global rate limiter for LLM API calls.

Rules
-----
- Max 10 requests per 60-second sliding window, system-wide.
- When the limit is hit, callers block (await) until a slot opens.
- Requests are served in FIFO order — asyncio's lock queues waiters fairly.

Usage
-----
    from services.rate_limiter import llm_rate_limiter
    await llm_rate_limiter.acquire()   # blocks until a slot is free
    result = await call_provider(...)
"""

import asyncio
import time
from collections import deque


class RateLimiter:
    """
    Sliding-window rate limiter.

    ``acquire()`` claims one request slot, blocking until one is available.
    The window is tracked with a deque of monotonic timestamps; entries older
    than ``period`` seconds are pruned on every acquire call so the window
    always reflects the last ``period`` seconds of activity.
    """

    def __init__(self, max_calls: int = 10, period: float = 60.0) -> None:
        self.max_calls = max_calls
        self.period = period
        # Timestamps (monotonic) of calls that are still inside the window
        self._timestamps: deque[float] = deque()
        # Lock ensures only one coroutine updates _timestamps at a time,
        # giving FIFO ordering to waiters via asyncio's fair queuing
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        """
        Block until a rate-limit slot is available, then claim it.

        Multiple concurrent callers queue up and are served one at a time.
        Each caller sleeps until exactly the moment its slot opens.
        """
        while True:
            async with self._lock:
                now = time.monotonic()

                # Prune timestamps that have expired out of the window
                while self._timestamps and self._timestamps[0] <= now - self.period:
                    self._timestamps.popleft()

                if len(self._timestamps) < self.max_calls:
                    # Slot available — claim it and return immediately
                    self._timestamps.append(now)
                    return

                # No slot yet: calculate exactly when the oldest entry expires
                # Add a small buffer (50 ms) to avoid tight re-check loops
                wait = self._timestamps[0] + self.period - now + 0.05

            # Release the lock while sleeping so other coroutines can run
            await asyncio.sleep(wait)

    @property
    def active_count(self) -> int:
        """Number of requests inside the current window (informational)."""
        now = time.monotonic()
        return sum(1 for t in self._timestamps if t > now - self.period)

    @property
    def queue_depth(self) -> int:
        """Approximate number of requests currently waiting for a slot."""
        return max(0, self.active_count - self.max_calls)


# ── Per-session throttler ──────────────────────────────────────────────────────

class SessionThrottler:
    """
    Per-workspace-session request counter with tiered delays.

    Tiers (applied before each request):
      - 0–9  requests  → no delay
      - 10–19 requests → 2 s delay
      - 20+  requests  → 5 s delay

    Returns True if a delay was applied (caller can signal "throttled" to client).
    """

    def __init__(self) -> None:
        # workspace_id → request count
        self._counts: dict[str, int] = {}
        self._lock = asyncio.Lock()

    async def tick(self, session_id: str) -> bool:
        """Increment counter for session and apply tier delay. Returns True if throttled."""
        async with self._lock:
            count = self._counts.get(session_id, 0)
            self._counts[session_id] = count + 1

        if count >= 20:
            await asyncio.sleep(5)
            return True
        if count >= 10:
            await asyncio.sleep(2)
            return True
        return False

    def reset(self, session_id: str) -> None:
        """Reset the counter for a session (e.g. on new analysis)."""
        self._counts.pop(session_id, None)


# ── Singletons ─────────────────────────────────────────────────────────────────
# All LLM callers import and use these single instances.
llm_rate_limiter = RateLimiter(max_calls=10, period=60.0)
session_throttler = SessionThrottler()
