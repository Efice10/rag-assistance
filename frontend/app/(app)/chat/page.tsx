"use client";

import { AlertCircle, FileText, Loader2, Send, ShieldCheck, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ClearanceBadge } from "@/components/Badges";
import { downloadDocument, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { streamChat } from "@/lib/sse";
import type { Source } from "@/lib/types";

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
  sources: Source[];
  error: string | null;
  streaming: boolean;
}

const SUGGESTIONS = [
  "What approvals do I need before making a purchase?",
  "Summarise the leave carry-forward rules.",
  "What are the travel booking requirements?",
];

export default function ChatPage() {
  const session = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  useEffect(() => () => abort.current?.abort(), []);

  function patch(id: number, change: (message: Message) => Message) {
    setMessages((current) => current.map((message) => (message.id === id ? change(message) : message)));
  }

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) {
      return;
    }

    const userId = nextId.current++;
    const replyId = nextId.current++;
    setMessages((current) => [
      ...current,
      { id: userId, role: "user", text: question, sources: [], error: null, streaming: false },
      { id: replyId, role: "assistant", text: "", sources: [], error: null, streaming: true },
    ]);
    setPrompt("");
    setBusy(true);
    setNotice(null);

    const controller = new AbortController();
    abort.current = controller;

    try {
      await streamChat(question, controller.signal, {
        onToken: (token) => patch(replyId, (message) => ({ ...message, text: message.text + token })),
        onSources: (sources) => patch(replyId, (message) => ({ ...message, sources })),
        onError: (message) => patch(replyId, (reply) => ({ ...reply, error: message })),
      });
    } catch (err) {
      if (!controller.signal.aborted) {
        patch(replyId, (reply) => ({ ...reply, error: errorMessage(err, "The request failed. Try again.") }));
      }
    } finally {
      patch(replyId, (reply) => ({ ...reply, streaming: false }));
      setBusy(false);
      abort.current = null;
    }
  }

  async function openSource(source: Source) {
    try {
      await downloadDocument(source.document_id, source.document_title);
    } catch (err) {
      setNotice(errorMessage(err, "Could not download that document."));
    }
  }

  const user = session?.user;

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Ask the assistant</h1>
          <p className="text-sm text-slate-600">
            Answers come only from documents in {user?.role === "admin" ? "your organization" : "your department"}{" "}
            at or below your clearance.
          </p>
        </div>
        {user && (
          <div className="flex items-center gap-2 text-sm text-slate-600" data-testid="active-clearance">
            <span>Searching as</span>
            <ClearanceBadge level={user.clearance_level} showIcon />
          </div>
        )}
      </div>

      <div
        className="flex flex-1 flex-col overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <div className="m-auto flex flex-col items-center py-8 text-center">
            <ShieldCheck className="h-10 w-10 text-indigo-200" aria-hidden />
            <p className="mt-3 text-sm font-medium text-slate-900">Ask about a policy, SOP, or manual</p>
            <p className="mt-1 max-w-md text-sm text-slate-600">
              Every answer cites the document and page it came from. If nothing you can access covers the
              question, the assistant will say so.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => send(suggestion)}
                  className="rounded-full border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:border-indigo-400 hover:bg-indigo-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-auto space-y-4">
          {messages.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="flex justify-end">
                <p className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-2 text-sm text-white">
                  {message.text}
                </p>
              </div>
            ) : (
              <div key={message.id} className="flex justify-start" data-testid="assistant-message">
                <div className="max-w-[85%]">
                  <div className="rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-2 text-sm text-slate-900">
                    {message.text ? (
                      <p className="whitespace-pre-wrap">{message.text}</p>
                    ) : message.streaming ? (
                      <span className="flex items-center gap-2 text-slate-500">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Searching your documents…
                      </span>
                    ) : null}
                    {message.error && (
                      <p role="alert" className="mt-1 flex items-start gap-1.5 text-rose-700">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        {message.error}
                      </p>
                    )}
                  </div>

                  {message.sources.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-2" aria-label="Sources">
                      {message.sources.map((source) => (
                        <li key={`${source.document_id}-${source.page_number}`}>
                          <button
                            type="button"
                            onClick={() => openSource(source)}
                            title="Download this document"
                            data-testid="citation"
                            className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-800 hover:bg-indigo-100"
                          >
                            <FileText className="h-3.5 w-3.5" aria-hidden />
                            {source.document_title} • Page {source.page_number}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ),
          )}
          <div ref={bottom} />
          </div>
        )}
      </div>

      {notice && (
        <p role="alert" className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {notice}
        </p>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          send(prompt);
        }}
        className="mt-4 flex items-end gap-2"
      >
        <label className="sr-only" htmlFor="prompt">
          Your question
        </label>
        <textarea
          id="prompt"
          name="prompt"
          rows={2}
          maxLength={2000}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send(prompt);
            }
          }}
          placeholder="Ask a question about your documents…"
          className="flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
        />
        {busy ? (
          <button
            type="button"
            onClick={() => abort.current?.abort()}
            className="flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            <Square className="h-4 w-4" aria-hidden />
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!prompt.trim()}
            className="flex h-10 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="h-4 w-4" aria-hidden />
            Send
          </button>
        )}
      </form>
    </div>
  );
}
