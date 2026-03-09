/**
 * Server-Sent Events stream parser for ReadableStream<Uint8Array>.
 *
 * Parses raw byte streams into typed SseEvent objects following the
 * W3C EventSource specification. Handles multi-line data fields,
 * comment lines (keepalives), incomplete chunk buffering, and the
 * retry/id/event fields. Never uses the browser EventSource API.
 *
 * @see https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream
 */

import type { SseEvent } from '../shared/types.js';

/**
 * Async generator that reads an SSE byte stream and yields parsed events.
 *
 * The parser buffers incomplete lines across chunks and dispatches an event
 * when an empty line is encountered (per the SSE spec). Comment lines
 * (starting with `:`) are silently consumed as keepalives.
 */
export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();

  // Accumulates incomplete line data between chunks
  let lineBuffer = '';

  // Fields for the event currently being assembled
  let eventType = '';
  let dataLines: string[] = [];
  let lastEventId: string | undefined;
  let retryMs: number | undefined;

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        // End of stream — if there's a partial line, process it
        if (lineBuffer.length > 0) {
          const event = processLine(lineBuffer);
          lineBuffer = '';

          if (event === 'dispatch') {
            const dispatched = dispatchEvent();
            if (dispatched) yield dispatched;
          }
        }

        // Dispatch any remaining accumulated event data
        if (dataLines.length > 0) {
          const dispatched = dispatchEvent();
          if (dispatched) yield dispatched;
        }
        break;
      }

      // Decode the chunk and append to the line buffer
      lineBuffer += decoder.decode(value, { stream: true });

      // Process complete lines (split on \r\n, \r, or \n)
      let searchStart = 0;
      for (;;) {
        // Find the next line ending
        let lineEnd = -1;
        let skipLen = 0;

        for (let i = searchStart; i < lineBuffer.length; i++) {
          const ch = lineBuffer[i];
          if (ch === '\r') {
            lineEnd = i;
            // \r\n counts as a single line ending
            skipLen = i + 1 < lineBuffer.length && lineBuffer[i + 1] === '\n' ? 2 : 1;
            break;
          }
          if (ch === '\n') {
            lineEnd = i;
            skipLen = 1;
            break;
          }
        }

        if (lineEnd === -1) {
          // No complete line found — keep the remainder in the buffer
          if (searchStart > 0) {
            lineBuffer = lineBuffer.slice(searchStart);
          }
          break;
        }

        const line = lineBuffer.slice(searchStart, lineEnd);
        searchStart = lineEnd + skipLen;

        const result = processLine(line);
        if (result === 'dispatch') {
          const dispatched = dispatchEvent();
          if (dispatched) yield dispatched;
        }
      }

      // If we consumed all characters, clear the buffer
      if (searchStart >= lineBuffer.length) {
        lineBuffer = '';
      }
    }
  } finally {
    reader.releaseLock();
  }

  /**
   * Processes a single line according to the SSE field parsing rules.
   * Returns 'dispatch' when an empty line triggers event dispatch.
   */
  function processLine(line: string): 'dispatch' | void {
    // Empty line = dispatch event
    if (line === '') {
      return 'dispatch';
    }

    // Comment line (keepalive or ignored)
    if (line[0] === ':') {
      return;
    }

    // Split on first colon
    const colonIdx = line.indexOf(':');

    let field: string;
    let value: string;

    if (colonIdx === -1) {
      // No colon — entire line is the field name, value is empty
      field = line;
      value = '';
    } else {
      field = line.slice(0, colonIdx);
      // Skip optional single space after colon
      value = colonIdx + 1 < line.length && line[colonIdx + 1] === ' '
        ? line.slice(colonIdx + 2)
        : line.slice(colonIdx + 1);
    }

    switch (field) {
      case 'event':
        eventType = value;
        break;
      case 'data':
        dataLines.push(value);
        break;
      case 'id':
        // Per spec: if the value does not contain U+0000, set lastEventId
        if (!value.includes('\0')) {
          lastEventId = value;
        }
        break;
      case 'retry': {
        const parsed = parseInt(value, 10);
        if (!Number.isNaN(parsed) && parsed >= 0) {
          retryMs = parsed;
        }
        break;
      }
      default:
        // Unknown fields are ignored per spec
        break;
    }
  }

  /**
   * Assembles and resets the current event fields, returning an SseEvent
   * if there is data to dispatch, or undefined if the event was empty.
   */
  function dispatchEvent(): SseEvent | undefined {
    if (dataLines.length === 0 && eventType === '' && lastEventId === undefined && retryMs === undefined) {
      return undefined;
    }

    const event: SseEvent = {
      event: eventType || 'message',
      data: dataLines.join('\n'),
      id: lastEventId,
      retry: retryMs,
    };

    // Reset fields for next event
    eventType = '';
    dataLines = [];
    retryMs = undefined;
    // Note: lastEventId persists across events per SSE spec

    return event;
  }
}
