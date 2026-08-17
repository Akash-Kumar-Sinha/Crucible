import type { StreamHandlers } from "./types";

export async function consumeSseStream(
  stream: ReadableStream<Uint8Array>,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulatedResponse = "";
  let doneDispatched = false;

  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      let currentEvent = "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          currentEvent = "";
          continue;
        }

        if (trimmed.startsWith("event:")) {
          currentEvent = trimmed.slice(6).trim();
          continue;
        }

        if (trimmed.startsWith("data:")) {
          const rawData = trimmed.slice(5).trim();
          if (!rawData || rawData === "[DONE]") {
            if (!doneDispatched) {
              doneDispatched = true;
              handlers.onDone?.(accumulatedResponse);
            }
            continue;
          }

          try {
            const parsed = JSON.parse(rawData);
            dispatchStreamEvent(currentEvent, parsed, handlers);

            const isToken = currentEvent === "token" || parsed.type === "token";
            if (isToken) {
              const text =
                typeof parsed === "string"
                  ? parsed
                  : parsed.content || parsed.token || "";
              accumulatedResponse += text;
            } else if (currentEvent === "done" || parsed.type === "done") {
              const doneText = parsed.response || parsed.content;
              if (doneText && !accumulatedResponse) {
                accumulatedResponse = doneText;
              }
              doneDispatched = true;
            }
          } catch {
            if (currentEvent === "token" || !currentEvent) {
              handlers.onToken?.(rawData);
              accumulatedResponse += rawData;
            }
          }
        }
      }
    }
  } catch (err: any) {
    if (signal?.aborted || err?.name === "AbortError") {
      return accumulatedResponse;
    }
    handlers.onError?.(err);
  } finally {
    reader.releaseLock();
  }

  if (!doneDispatched) {
    handlers.onDone?.(accumulatedResponse);
  }
  return accumulatedResponse;
}

function dispatchStreamEvent(
  eventType: string,
  data: any,
  handlers: StreamHandlers,
): void {
  const type = eventType || data?.type;

  switch (type) {
    case "token":
      if (typeof data === "string") {
        handlers.onToken?.(data);
      } else if (data.content) {
        handlers.onToken?.(data.content);
      } else if (data.token) {
        handlers.onToken?.(data.token);
      }
      break;

    case "thought":
      if (typeof data === "string") {
        handlers.onThought?.(data);
      } else if (data.content) {
        handlers.onThought?.(data.content);
      } else if (data.thought) {
        handlers.onThought?.(data.thought);
      }
      break;

    case "action":
      if (Array.isArray(data.actions)) {
        handlers.onAction?.(data.actions);
      } else if (Array.isArray(data)) {
        handlers.onAction?.(data);
      } else if (data.action) {
        handlers.onAction?.([data.action]);
      }
      break;

    case "observation":
      if (Array.isArray(data.observations)) {
        handlers.onObservation?.(data.observations);
      } else if (Array.isArray(data)) {
        handlers.onObservation?.(data);
      } else if (data.observation) {
        handlers.onObservation?.([data.observation]);
      }
      break;

    case "state_change":
      handlers.onStateChange?.(data.state || data.to, data.from);
      break;

    case "status_change":
      handlers.onStatusChange?.(data.status);
      break;

    case "done":
      handlers.onDone?.(data.response || data.content);
      break;

    case "error":
      handlers.onError?.(data.error || data);
      break;

    default:
      if (data?.content && typeof data.content === "string") {
        handlers.onToken?.(data.content);
      }
      break;
  }
}
