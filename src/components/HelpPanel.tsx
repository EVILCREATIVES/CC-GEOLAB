"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Message = {
  role: "user" | "assistant";
  text: string;
};

const starterPrompts = [
  "Summarize likely lithology from what I loaded.",
  "How do I interpret min/max depth vs thickness?",
  "What checks should I run on uncertain vein traces?",
];

function useIsMobile(breakpoint = 768) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    setMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);
  return mobile;
}

export default function HelpPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  // On desktop, default to open; on mobile, default to closed
  useEffect(() => {
    setOpen(!isMobile);
  }, [isMobile]);

  const canSend = useMemo(() => input.trim().length > 0 && !loading, [input, loading]);

  async function submitText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const nextMessages = [...messages, { role: "user" as const, text: trimmed }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/gemini", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages: nextMessages }),
      });

      const data = (await response.json()) as { text?: string; error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Request failed.");
      }

      setMessages((prev) => [...prev, { role: "assistant", text: data.text ?? "No answer." }]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to contact assistant.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitText(input);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open Geo Assistant"
        style={{
          position: "absolute",
          right: 14,
          top: 14,
          zIndex: 10050,
          width: 48,
          height: 48,
          borderRadius: "50%",
          border: "1px solid var(--line)",
          background: "var(--panel)",
          backdropFilter: "blur(8px)",
          color: "var(--text)",
          fontSize: 22,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 4px 16px rgba(0,0,0,.45)",
        }}
      >
        ✨
      </button>
    );
  }

  return (
    <aside
      style={{
        position: "absolute",
        right: isMobile ? 0 : 14,
        top: isMobile ? 0 : 14,
        bottom: isMobile ? 0 : 14,
        width: isMobile ? "100%" : "min(360px, calc(100vw - 28px))",
        zIndex: 10050,
        background: "var(--panel)",
        border: isMobile ? "none" : "1px solid var(--line)",
        borderRadius: isMobile ? 0 : 14,
        backdropFilter: "blur(8px)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: 700, letterSpacing: 0.3 }}>Geo Assistant</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
            Gemini 3.1 Pro Preview consultation for interpretation and QA.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close assistant"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--muted)",
            fontSize: 20,
            cursor: "pointer",
            padding: "4px 8px",
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      <div
        style={{
          padding: "10px 12px",
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          borderBottom: "1px solid var(--line)",
        }}
      >
        {starterPrompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => submitText(prompt)}
            disabled={loading}
            style={{
              border: "1px solid var(--line)",
              borderRadius: 999,
              background: "rgba(33, 56, 87, 0.55)",
              color: "var(--text)",
              cursor: loading ? "not-allowed" : "pointer",
              fontSize: 11,
              padding: "5px 10px",
            }}
          >
            {prompt}
          </button>
        ))}
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {messages.length === 0 && (
          <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
            Ask about anomalies, depth relationships, confidence levels, or recommended next field checks.
          </div>
        )}

        {messages.map((m, idx) => (
          <div
            key={`${m.role}-${idx}`}
            style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "92%",
              border: "1px solid var(--line)",
              background: m.role === "user" ? "rgba(46, 168, 255, 0.22)" : "rgba(16, 24, 36, 0.7)",
              borderRadius: 10,
              padding: "8px 10px",
              whiteSpace: "pre-wrap",
              fontSize: 13,
              lineHeight: 1.45,
            }}
          >
            {m.text}
          </div>
        ))}

        {loading && <div style={{ fontSize: 12, color: "var(--muted)" }}>Thinking...</div>}
        {error && <div style={{ color: "#ff9e9e", fontSize: 12 }}>{error}</div>}
      </div>

      <form onSubmit={onSubmit} style={{ borderTop: "1px solid var(--line)", padding: 12 }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about loaded geological features..."
          rows={3}
          style={{
            width: "100%",
            resize: "vertical",
            minHeight: 72,
            maxHeight: 180,
            borderRadius: 10,
            border: "1px solid var(--line)",
            background: "rgba(4, 8, 14, 0.75)",
            color: "var(--text)",
            padding: 10,
            outline: "none",
            fontSize: 13,
            lineHeight: 1.4,
          }}
        />
        <button
          type="submit"
          disabled={!canSend}
          style={{
            marginTop: 10,
            width: "100%",
            border: "none",
            borderRadius: 10,
            padding: "9px 12px",
            background: canSend ? "var(--accent)" : "#4b5f76",
            color: "#001425",
            fontWeight: 700,
            cursor: canSend ? "pointer" : "not-allowed",
          }}
        >
          Send
        </button>
      </form>
    </aside>
  );
}
