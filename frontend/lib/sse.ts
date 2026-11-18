import { API_URL } from "./api";
import { getSession, setSession } from "./session";
import type { SavedTurn, Source } from "./types";

export interface ChatHandlers {
  onToken: (text: string) => void;
  onSources: (sources: Source[]) => void;
  onError: (message: string) => void;
  /** Laravel's own event after the relayed stream: where the turn was stored. */
  onSaved?: (saved: SavedTurn) => void;
}

/**
 * Send a prompt to Laravel's /chat endpoint and read the Server-Sent Events
 * reply. Only the prompt (and the user's own conversation id, for a
 * follow-up) is sent: the server decides what the user may see.
 */
export async function streamChat(
  prompt: string,
  signal: AbortSignal,
  handlers: ChatHandlers,
  conversationId: number | null = null,
): Promise<void> {
  const session = getSession();

  const response = await fetch(`${API_URL}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${session?.token ?? ""}`,
    },
    body: JSON.stringify(conversationId ? { prompt, conversation_id: conversationId } : { prompt }),
    signal,
  });

  if (response.status === 401) {
    setSession(null);
    throw new Error("Your session has expired. Sign in again.");
  }
  if (response.status === 429) {
    throw new Error("You are sending prompts too quickly. Wait a minute and try again.");
  }
  if (!response.ok || !response.body) {
    let message: string | undefined;
    try {
      message = ((await response.json()) as { message?: string }).message;
    } catch {
      // Not JSON; fall through to the generic message.
    }
    throw new Error(message ?? "The request failed. Try again.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      dispatch(buffer.slice(0, boundary), handlers);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
  }
}

function dispatch(rawEvent: string, handlers: ChatHandlers): void {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of rawEvent.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  let payload: { text?: string; sources?: Source[]; message?: string } & Partial<SavedTurn> = {};
  try {
    payload = JSON.parse(dataLines.join("\n") || "{}");
  } catch {
    return;
  }

  if (event === "token" && payload.text) {
    handlers.onToken(payload.text);
  } else if (event === "sources") {
    handlers.onSources(payload.sources ?? []);
  } else if (event === "error") {
    handlers.onError(payload.message ?? "The assistant could not complete this request.");
  } else if (event === "saved" && payload.conversation_id && payload.message_id) {
    handlers.onSaved?.({
      conversation_id: payload.conversation_id,
      title: payload.title ?? "",
      message_id: payload.message_id,
    });
  }
}
