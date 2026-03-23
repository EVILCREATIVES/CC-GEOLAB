"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";

const HF_SPACE_URL = "https://evilcreatives-kmz-app.hf.space";

export default function ConvertPanel() {
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const iv = setInterval(() => {
      const el = document.getElementById("settingsBody");
      if (el) {
        setHost(el);
        clearInterval(iv);
      }
    }, 200);
    return () => clearInterval(iv);
  }, []);

  const button = (
    <button
      onClick={() => setOpen(true)}
      title="Convert 2D KMZ to 3D KMZ (external tool)"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "#1a73e8",
        color: "#fff",
        border: "none",
        borderRadius: 6,
        padding: "8px 14px",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        width: "100%",
        justifyContent: "center",
        marginTop: 8,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
      2D → 3D Converter
    </button>
  );

  const modal = open
    ? createPortal(
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 20000,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={() => setOpen(false)}
        >
          <div
            style={{
              position: "relative",
              width: "min(95vw, 900px)",
              height: "min(90vh, 750px)",
              background: "#1a1a1a",
              borderRadius: 12,
              overflow: "hidden",
              boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 16px",
                background: "#111",
                borderBottom: "1px solid #333",
              }}
            >
              <span
                style={{
                  color: "#fff",
                  fontSize: 15,
                  fontWeight: 600,
                  fontFamily: "system-ui, sans-serif",
                }}
              >
                KMZ 2D → 3D Converter
              </span>
              <button
                onClick={() => setOpen(false)}
                style={{
                  background: "#333",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  padding: "4px 12px",
                  fontSize: 13,
                  cursor: "pointer",
                  fontFamily: "system-ui, sans-serif",
                }}
              >
                ✕ Close
              </button>
            </div>
            <iframe
              src={HF_SPACE_URL}
              style={{ flex: 1, width: "100%", border: "none" }}
              title="KMZ 2D to 3D Converter"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
            />
          </div>
        </div>,
        document.body,
      )
    : null;

  if (!host) return <>{modal}</>;
  return (
    <>
      {createPortal(button, host)}
      {modal}
    </>
  );
}
