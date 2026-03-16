"use client";

import { useState } from "react";

const HF_SPACE_URL = "https://evilcreatives-kmz-app.hf.space";

export default function ConvertPanel() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        title="Convert 2D KMZ to 3D KMZ"
        style={{
          position: "fixed",
          bottom: 24,
          left: 24,
          zIndex: 10001,
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "#1a73e8",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          padding: "10px 16px",
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
          boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
        2D → 3D
      </button>

      {/* Modal overlay */}
      {open && (
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
            {/* Header */}
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
              <span style={{ color: "#fff", fontSize: 15, fontWeight: 600, fontFamily: "system-ui, sans-serif" }}>
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

            {/* Iframe */}
            <iframe
              src={HF_SPACE_URL}
              style={{
                flex: 1,
                width: "100%",
                border: "none",
              }}
              title="KMZ 2D to 3D Converter"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
            />
          </div>
        </div>
      )}
    </>
  );
}
