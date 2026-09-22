// Reads a Server-Sent Events response body as it arrives and calls
// onEvent(name, data) for each frame. Not EventSource — see useOrderStream.js
// for why — so parsing the wire format is done by hand here: frames are
// separated by a blank line, comment lines (heartbeats, the opening
// "connected" ping — see server/src/orderStream.js) start with ":" and are
// ignored, everything else is `event: <name>` + `data: <json>`.
//
// Resolves once the stream ends (server closed it, or the connection
// dropped) or the given AbortSignal fires. Never rejects on a clean abort —
// that's an expected way to stop reading, not a failure.
export async function readEventStream(response, onEvent) {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });

      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (raw.startsWith(':')) continue; // heartbeat / opening comment

        const event = raw.match(/^event: (.+)$/m)?.[1];
        const data = raw.match(/^data: (.+)$/m)?.[1];
        if (!event || !data) continue;
        try {
          onEvent(event, JSON.parse(data));
        } catch (err) {
          console.error('[sse] bad frame from the server, ignoring it', err);
        }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') throw err; // an abort is a normal way to stop, not a failure
  }
}
