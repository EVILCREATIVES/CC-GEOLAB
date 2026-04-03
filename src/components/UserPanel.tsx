"use client";

import { useState, useEffect } from "react";
import { useGeoData, type UserInfo } from "@/context/GeoDataContext";

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

export default function UserPanel() {
  const { user, setUser } = useGeoData();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setEmail(""); setPassword(""); setFirstName(""); setLastName(""); setCompany(""); setError("");
  };

  const handleLogin = async () => {
    setError(""); setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Login failed"); return; }
      setUser(data.user as UserInfo);
      setOpen(false);
      reset();
    } catch { setError("Network error"); }
    finally { setLoading(false); }
  };

  const handleRegister = async () => {
    setError(""); setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, firstName, lastName, company }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Registration failed"); return; }
      // Auto-login after register
      setUser(data.user as UserInfo);
      setOpen(false);
      reset();
    } catch { setError("Network error"); }
    finally { setLoading(false); }
  };

  const logout = () => {
    setUser(null);
    reset();
  };

  // Logged-in badge
  if (user) {
    return (
      <div style={{ ...S.badge, ...(isMobile ? { bottom: 60, right: 8 } : {}) }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {user.firstName} {user.lastName}
        </span>
        <button onClick={logout} style={S.smallBtn}>Logout</button>
      </div>
    );
  }

  return (
    <>
      <button onClick={() => setOpen(!open)} style={{ ...S.triggerBtn, ...(isMobile ? { bottom: 60, right: 8, width: 34, height: 34, fontSize: 16 } : {}) }} title="Login / Register">
        👤
      </button>
      {open && (
        <div style={{ ...S.panel, ...(isMobile ? { bottom: 0, right: 0, left: 0, width: "100%", borderRadius: "12px 12px 0 0" } : {}) }}>
          <div style={S.panelHeader}>
            <button onClick={() => { setMode("login"); setError(""); }} style={{ ...S.tabBtn, ...(mode === "login" ? S.tabActive : {}) }}>Login</button>
            <button onClick={() => { setMode("register"); setError(""); }} style={{ ...S.tabBtn, ...(mode === "register" ? S.tabActive : {}) }}>Register</button>
            <button onClick={() => setOpen(false)} style={S.closeBtn}>✕</button>
          </div>

          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            {mode === "register" && (
              <>
                <input placeholder="First name *" value={firstName} onChange={(e) => setFirstName(e.target.value)} style={S.input} />
                <input placeholder="Last name *" value={lastName} onChange={(e) => setLastName(e.target.value)} style={S.input} />
                <input placeholder="Company" value={company} onChange={(e) => setCompany(e.target.value)} style={S.input} />
              </>
            )}
            <input placeholder="Email *" type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={S.input} />
            <input
              placeholder="Password *"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (mode === "login" ? handleLogin() : handleRegister())}
              style={S.input}
            />
            <button
              onClick={mode === "login" ? handleLogin : handleRegister}
              disabled={loading}
              style={S.submitBtn}
            >
              {loading ? "…" : mode === "login" ? "Login" : "Create Account"}
            </button>
            {error && <p style={{ color: "#f66", margin: 0, fontSize: 12 }}>{error}</p>}
          </div>
        </div>
      )}
    </>
  );
}

const S: Record<string, React.CSSProperties> = {
  triggerBtn: {
    position: "fixed", bottom: 100, right: 14,
    width: 38, height: 38, borderRadius: "50%",
    background: "rgba(8,12,18,0.85)", border: "1px solid rgba(137,168,201,0.25)",
    color: "#e7eef8", fontSize: 18, cursor: "pointer", zIndex: 9000,
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  badge: {
    position: "fixed", bottom: 100, right: 14,
    background: "rgba(8,12,18,0.9)", border: "1px solid rgba(137,168,201,0.25)",
    borderRadius: 8, padding: "6px 12px", zIndex: 9000,
    display: "flex", alignItems: "center", gap: 8,
  },
  smallBtn: {
    background: "none", border: "1px solid rgba(137,168,201,0.2)", borderRadius: 4,
    color: "var(--muted)", fontSize: 11, padding: "2px 8px", cursor: "pointer",
  },
  panel: {
    position: "fixed", bottom: 60, right: 14,
    width: 300, background: "rgba(8,12,18,0.95)",
    border: "1px solid rgba(137,168,201,0.25)", borderRadius: 12,
    zIndex: 9001, overflow: "hidden",
  },
  panelHeader: {
    display: "flex", borderBottom: "1px solid rgba(137,168,201,0.15)",
  },
  tabBtn: {
    flex: 1, padding: "10px 0", background: "none", border: "none",
    color: "var(--muted)", cursor: "pointer", fontSize: 13, fontFamily: "inherit",
    borderBottom: "2px solid transparent",
  },
  tabActive: {
    color: "#2ea8ff", borderBottomColor: "#2ea8ff",
  },
  closeBtn: {
    background: "none", border: "none", color: "var(--muted)", cursor: "pointer",
    padding: "10px 12px", fontSize: 14,
  },
  input: {
    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(137,168,201,0.2)",
    borderRadius: 6, color: "#e7eef8", padding: "8px 10px", fontSize: 13,
    fontFamily: "inherit", width: "100%", outline: "none",
  },
  submitBtn: {
    background: "#2ea8ff", border: "none", borderRadius: 6,
    color: "#fff", padding: "9px 0", cursor: "pointer", fontSize: 13, fontFamily: "inherit",
  },
};
