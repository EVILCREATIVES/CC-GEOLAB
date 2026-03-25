"use client";

import { useState, useEffect, useCallback } from "react";
import { useGeoData } from "@/context/GeoDataContext";

type HistoryItem = {
  id: string;
  fileName: string;
  blobUrl: string;
  blobSize: number;
  createdAt: string;
};

export default function HistoryPanel() {
  const { user } = useGeoData();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/uploads?userId=${encodeURIComponent(user.id)}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.uploads || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (open && user) load();
  }, [open, user, load]);

  // Only show for logged-in users
  if (!user) return null;

  return (
    <>
      <button onClick={() => setOpen(!open)} style={S.triggerBtn} title="Upload History">
        📁
      </button>
      {open && (
        <div style={S.panel}>
          <div style={S.header}>
            <strong style={{ color: "var(--accent)" }}>My Uploads</strong>
            <button onClick={() => setOpen(false)} style={S.closeBtn}>✕</button>
          </div>
          <div style={S.body}>
            {loading && <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</p>}
            {!loading && !items.length && (
              <p style={{ color: "var(--muted)", fontSize: 13 }}>No uploads yet</p>
            )}
            {items.map((it) => (
              <div key={it.id} style={S.item}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {it.fileName}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    {new Date(it.createdAt).toLocaleString()} · {(it.blobSize / 1024).toFixed(0)} KB
                  </div>
                </div>
                <a href={it.blobUrl} target="_blank" rel="noopener noreferrer" style={S.dlBtn} title="Download">⬇</a>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

const S: Record<string, React.CSSProperties> = {
  triggerBtn: {
    position: "fixed", bottom: 146, right: 14,
    width: 38, height: 38, borderRadius: "50%",
    background: "rgba(8,12,18,0.85)", border: "1px solid rgba(137,168,201,0.25)",
    color: "#e7eef8", fontSize: 18, cursor: "pointer", zIndex: 9000,
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  panel: {
    position: "fixed", bottom: 60, right: 60,
    width: 340, maxHeight: 420, background: "rgba(8,12,18,0.95)",
    border: "1px solid rgba(137,168,201,0.25)", borderRadius: 12,
    zIndex: 9001, overflow: "hidden", display: "flex", flexDirection: "column",
  },
  header: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "12px 16px", borderBottom: "1px solid rgba(137,168,201,0.15)",
  },
  closeBtn: {
    background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 14,
  },
  body: {
    padding: 12, overflowY: "auto", flex: 1,
  },
  item: {
    display: "flex", alignItems: "center", gap: 8,
    padding: "8px 0", borderBottom: "1px solid rgba(137,168,201,0.08)",
  },
  dlBtn: {
    background: "rgba(46,168,255,0.15)", border: "1px solid rgba(46,168,255,0.3)",
    borderRadius: 6, color: "#2ea8ff", padding: "4px 8px", fontSize: 14,
    textDecoration: "none", cursor: "pointer",
  },
};
