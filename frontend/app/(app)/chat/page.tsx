"use client";

import {
  AlertCircle,
  EyeOff,
  FileText,
  History,
  Loader2,
  MessageSquarePlus,
  Send,
  ShieldCheck,
  Square,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ClearanceBadge } from "@/components/Badges";
import { SourceViewer } from "@/components/SourceViewer";
import { api, errorMessage } from "@/lib/api";
import { confirmAction, toast } from "@/lib/feedback";
import { useSession } from "@/lib/session";
import { streamChat } from "@/lib/sse";
import type { ConversationSummary, Feedback, Source, StoredMessage } from "@/lib/types";

interface Message {
  key: number;
  /** The stored message id, once Laravel has saved the turn. */
  id: number | null;
  role: "user" | "assistant";
  text: string;
  sources: Source[];
  error: string | null;
  withheld: boolean;
  streaming: boolean;
  feedback: Feedback | null;
}

const SUGGESTIONS = [
  "What approvals do I need before making a purchase?",
  "Summarise the leave carry-forward rules.",
  "What are the travel booking requirements?",
];

export default function ChatPage() {
  const session = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Source | null>(null);
  const abort = useRef<AbortController | null>(null);
  const nextKey = useRef(1);
  const bottom = useRef<HTMLDivElement>(null);
  const promptBox = useRef<HTMLTextAreaElement>(null);

  const loadConversations = useCallback(() => {
    api
      .get<{ data: ConversationSummary[] }>("/conversations")
      .then(({ data }) => setConversations(data.data))
      .catch(() => setConversations((current) => current ?? []));
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  useEffect(() => () => abort.current?.abort(), []);

  // Grow the question box with its text, up to about eight lines.
  useEffect(() => {
    const box = promptBox.current;
    if (box) {
      box.style.height = "auto";
      box.style.height = `${Math.min(box.scrollHeight, 200)}px`;
    }
  }, [prompt]);

  function patch(key: number, change: (message: Message) => Message) {
    setMessages((current) => current.map((message) => (message.key === key ? change(message) : message)));
  }

  function startNew() {
    abort.current?.abort();
    setMessages([]);
    setConversationId(null);
    setNotice(null);
    setShowHistory(false);
  }

  async function open(id: number) {
    if (busy) {
      return;
    }
    setLoadingConversation(true);
    setNotice(null);
    setShowHistory(false);
    try {
      const { data } = await api.get<{ data: { id: number; messages: StoredMessage[] } }>(`/conversations/${id}`);
      setConversationId(data.data.id);
      setMessages(
        data.data.messages.map((stored) => ({
          key: nextKey.current++,
          id: stored.id,
          role: stored.role,
          text: stored.content,
          sources: stored.sources,
          error: stored.error,
          withheld: stored.withheld,
          streaming: false,
          feedback: stored.feedback,
        })),
      );
    } catch (err) {
      setNotice(errorMessage(err, "Could not open that conversation."));
    } finally {
      setLoadingConversation(false);
    }
  }

  async function remove(id: number) {
    const confirmed = await confirmAction({
      title: "Delete this conversation?",
      body: "It is removed from your history. The audit log keeps its own record of the prompts.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }
    try {
      await api.delete(`/conversations/${id}`);
      setConversations((current) => current?.filter((conversation) => conversation.id !== id) ?? null);
      if (id === conversationId) {
        startNew();
      }
      toast.success("Conversation deleted.");
    } catch (err) {
      toast.error(errorMessage(err, "Could not delete that conversation."));
    }
  }

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) {
      return;
    }

    const userKey = nextKey.current++;
    const replyKey = nextKey.current++;
    const blank = { id: null, sources: [], error: null, withheld: false, feedback: null };
    setMessages((current) => [
      ...current,
      { ...blank, key: userKey, role: "user", text: question, streaming: false },
      { ...blank, key: replyKey, role: "assistant", text: "", streaming: true },
    ]);
    setPrompt("");
    setBusy(true);
    setNotice(null);

    const controller = new AbortController();
    abort.current = controller;

    try {
      await streamChat(
        question,
        controller.signal,
        {
          onToken: (token) => patch(replyKey, (message) => ({ ...message, text: message.text + token })),
          onSources: (sources) => patch(replyKey, (message) => ({ ...message, sources })),
          onError: (message) => patch(replyKey, (reply) => ({ ...reply, error: message })),
          onSaved: (saved) => {
            setConversationId(saved.conversation_id);
            patch(replyKey, (reply) => ({ ...reply, id: saved.message_id }));
            loadConversations();
          },
        },
        conversationId,
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        patch(replyKey, (reply) => ({ ...reply, error: errorMessage(err, "The request failed. Try again.") }));
      }
    } finally {
      patch(replyKey, (reply) => ({ ...reply, streaming: false }));
      setBusy(false);
      abort.current = null;
    }
  }

  async function rate(message: Message, helpful: boolean, comment: string | null = null) {
    if (!message.id) {
      return;
    }
    const previous = message.feedback;
    patch(message.key, (current) => ({ ...current, feedback: { helpful, comment } }));
    try {
      await api.post(`/messages/${message.id}/feedback`, { helpful, comment });
    } catch (err) {
      patch(message.key, (current) => ({ ...current, feedback: previous }));
      setNotice(errorMessage(err, "Could not save your rating."));
    }
  }

  const user = session?.user;

  const historyList = (
    <div className="flex h-full flex-col">
      <button
        type="button"
        onClick={startNew}
        className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
      >
        <MessageSquarePlus className="h-4 w-4" aria-hidden /> New chat
      </button>
      <p className="mt-4 px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Your conversations</p>
      <ul className="mt-1 flex-1 space-y-0.5 overflow-y-auto" aria-label="Conversation history" data-testid="conversation-list">
        {conversations === null ? (
          <li className="flex items-center gap-2 px-2 py-2 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading…
          </li>
        ) : conversations.length === 0 ? (
          <li className="px-2 py-2 text-xs text-slate-500">Your chats are saved here.</li>
        ) : (
          conversations.map((conversation) => (
            <li key={conversation.id} className="group flex items-center gap-1">
              <button
                type="button"
                onClick={() => open(conversation.id)}
                aria-current={conversation.id === conversationId ? "true" : undefined}
                className={`min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm ${
                  conversation.id === conversationId
                    ? "bg-indigo-50 font-medium text-indigo-700"
                    : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {conversation.title}
              </button>
              <button
                type="button"
                onClick={() => remove(conversation.id)}
                aria-label={`Delete conversation ${conversation.title}`}
                className="rounded p-1 text-slate-400 opacity-0 hover:bg-rose-50 hover:text-rose-700 focus:opacity-100 group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );

  return (
    <div className="flex flex-1 gap-6">
      <aside className="hidden w-60 shrink-0 lg:block">{historyList}</aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Ask the assistant</h1>
            <p className="text-sm text-slate-600">
              Answers come only from documents in {user?.role === "admin" ? "your organization" : "your department"}{" "}
              at or below your clearance.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowHistory((open) => !open)}
              aria-expanded={showHistory}
              className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 lg:hidden"
            >
              <History className="h-4 w-4" aria-hidden /> History
            </button>
            {user && (
              <div className="flex items-center gap-2 text-sm text-slate-600" data-testid="active-clearance">
                <span>Searching as</span>
                <ClearanceBadge level={user.clearance_level} showIcon />
              </div>
            )}
          </div>
        </div>

        {showHistory && (
          <div className="mb-4 max-h-72 rounded-xl border border-slate-200 bg-white p-3 shadow-sm lg:hidden">
            {historyList}
          </div>
        )}

        <div
          className="flex flex-1 flex-col overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          aria-live="polite"
        >
          {loadingConversation ? (
            <div className="m-auto flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Opening conversation…
            </div>
          ) : messages.length === 0 ? (
            <div className="m-auto flex flex-col items-center py-8 text-center">
              <ShieldCheck className="h-10 w-10 text-indigo-200" aria-hidden />
              <p className="mt-3 text-sm font-medium text-slate-900">Ask about a policy, SOP, or manual</p>
              <p className="mt-1 max-w-md text-sm text-slate-600">
                Every answer cites the document and page it came from. If nothing you can access covers the
                question, the assistant will say so. Follow-up questions keep the context of the conversation.
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
                  <div key={message.key} className="flex justify-end">
                    <p className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-2 text-sm text-on-accent">
                      {message.text}
                    </p>
                  </div>
                ) : (
                  <div key={message.key} className="flex justify-start" data-testid="assistant-message">
                    <div className="max-w-[85%]">
                      <div className="rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-2 text-sm text-slate-900">
                        {message.withheld ? (
                          <p className="flex items-start gap-1.5 italic text-slate-500">
                            <EyeOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                            {message.text}
                          </p>
                        ) : message.text ? (
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
                                onClick={() => setViewing(source)}
                                title="Open this document at the cited page"
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

                      {message.id && !message.streaming && !message.error && !message.withheld && (
                        <FeedbackBar message={message} onRate={rate} />
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
            ref={promptBox}
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
            placeholder={conversationId ? "Ask a follow-up…" : "Ask a question about your documents…"}
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
              className="flex h-10 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-on-accent hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-4 w-4" aria-hidden />
              Send
            </button>
          )}
        </form>
      </div>

      {viewing && <SourceViewer source={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function FeedbackBar({
  message,
  onRate,
}: {
  message: Message;
  onRate: (message: Message, helpful: boolean, comment?: string | null) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [comment, setComment] = useState("");
  const helpful = message.feedback?.helpful;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-slate-500" data-testid="feedback">
      <span className="mr-1">Was this helpful?</span>
      <button
        type="button"
        onClick={() => {
          setAsking(false);
          onRate(message, true);
        }}
        aria-label="Helpful"
        aria-pressed={helpful === true}
        className={`rounded p-1 hover:bg-slate-100 ${helpful === true ? "text-emerald-600" : ""}`}
      >
        <ThumbsUp className="h-3.5 w-3.5" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => {
          onRate(message, false);
          setAsking(true);
        }}
        aria-label="Not helpful"
        aria-pressed={helpful === false}
        className={`rounded p-1 hover:bg-slate-100 ${helpful === false ? "text-rose-600" : ""}`}
      >
        <ThumbsDown className="h-3.5 w-3.5" aria-hidden />
      </button>
      {asking && (
        <form
          className="flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            onRate(message, false, comment.trim() || null);
            setAsking(false);
          }}
        >
          <label className="sr-only" htmlFor={`feedback-${message.key}`}>
            What was wrong?
          </label>
          <input
            id={`feedback-${message.key}`}
            value={comment}
            maxLength={1000}
            onChange={(event) => setComment(event.target.value)}
            placeholder="What was wrong? (optional)"
            className="w-56 rounded border border-slate-300 px-2 py-1 text-xs text-slate-900"
          />
          <button type="submit" className="rounded border border-slate-300 bg-white px-2 py-1 font-medium text-slate-700">
            Send
          </button>
        </form>
      )}
    </div>
  );
}
