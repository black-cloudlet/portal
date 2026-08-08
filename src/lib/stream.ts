/**
 * Client-side helper for the Serverless API's SSE endpoints.
 *
 * Browsers authenticate a stream with a short-lived ticket in the URL
 * (EventSource cannot send an Authorization header), minted server-side from
 * the user's session via a server action. Tickets sign one path and expire in
 * about a minute, so EventSource's built-in reconnect - which would replay the
 * same URL - is not enough: on any error this closes the source, mints a fresh
 * ticket, and reopens with backoff. A stream that cannot be (re)opened reports
 * itself down so the caller can fall back to snapshot polling.
 */

export interface StreamHandle {
  close(): void;
}

/** How many consecutive failed opens before we declare the stream down. */
const MAX_ATTEMPTS = 4;

export function openTicketedStream({
  mint,
  events,
  onDown,
}: {
  /** Mint a fresh ticketed URL, or null when streaming is unavailable (503/no CORS). */
  mint: () => Promise<string | null>;
  /** Named SSE events to listen for; data arrives JSON-parsed. */
  events: Record<string, (data: unknown) => void>;
  /** The stream is not coming back; switch to polling. */
  onDown: () => void;
}): StreamHandle {
  let source: EventSource | null = null;
  let closed = false;
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function open() {
    if (closed) return;
    let url: string | null;
    try {
      url = await mint();
    } catch {
      url = null;
    }
    if (closed) return;
    if (!url) {
      onDown();
      return;
    }

    const es = new EventSource(url);
    source = es;
    for (const [name, handler] of Object.entries(events)) {
      es.addEventListener(name, (e) => {
        // Data received means the stream is healthy; reset the backoff.
        attempts = 0;
        try {
          handler(JSON.parse((e as MessageEvent).data));
        } catch {
          // A malformed event is dropped rather than killing the stream.
        }
      });
    }
    es.onerror = () => {
      // Never let EventSource retry on its own: the ticket in its URL expires.
      es.close();
      if (closed || source !== es) return;
      attempts += 1;
      if (attempts > MAX_ATTEMPTS) {
        onDown();
        return;
      }
      timer = setTimeout(() => void open(), Math.min(1000 * 2 ** attempts, 15000));
    };
  }

  void open();
  return {
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      source?.close();
    },
  };
}
