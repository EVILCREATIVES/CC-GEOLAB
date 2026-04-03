"use client";

import { useState, useEffect, useCallback } from "react";
import AdminJoystickPresetPanel from "@/components/AdminJoystickPresetPanel";

type Tab = "logs" | "users" | "rules" | "joystick" | "reports";

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("logs");

  const login = async () => {
    setError("");
    const res = await fetch("/api/admin/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      setToken(password);
    } else {
      setError("Wrong password");
    }
  };

  if (!token) {
    return (
      <div style={styles.page}>
        <div style={styles.loginBox}>
          <h2 style={{ margin: 0, color: "var(--accent)" }}>Admin Login</h2>
          <input
            type="password"
            placeholder="Admin password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && login()}
            style={styles.input}
          />
          <button onClick={login} style={styles.btn}>Login</button>
          {error && <p style={{ color: "#f66", margin: 0 }}>{error}</p>}
        </div>
      </div>
    );
  }



  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <h1 style={{ margin: 0, fontSize: 20, color: "var(--accent)" }}>CC GEOLAB Admin</h1>
          <div style={{ display: "flex", gap: 8 }}>
            <a href="/" style={{ ...styles.btn, background: "#1a3a5c", textDecoration: "none", display: "inline-flex", alignItems: "center" }}>← Back to Map</a>
            <button onClick={() => setToken(null)} style={{ ...styles.btn, background: "#333" }}>Logout</button>
          </div>
        </div>
        <div style={styles.tabs}>
          {(["logs", "users", "rules", "joystick", "reports"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{ ...styles.tab, ...(tab === t ? styles.tabActive : {}) }}
            >
              {t === "logs"
                ? "Access Logs"
                : t === "users"
                ? "Registered Users"
                : t === "rules"
                ? "AI Rules"
                : t === "joystick"
                ? "Joystick Preset"
                : "Report Training"}
            </button>
          ))}
        </div>
        {tab === "logs" && <LogsTab token={token} />}
        {tab === "users" && <UsersTab token={token} />}
        {tab === "rules" && <RulesTab token={token} />}
        {tab === "joystick" && <AdminJoystickPresetPanel />}
        {tab === "reports" && <ReportTrainingTab token={token} />}
      </div>
    </div>
  );
}

type LogEntry = { id: string; createdAt: string; ip: string; region: string; path: string; fileName: string | null; userId: string | null };
type UserEntry = { id: string; email: string; firstName: string; lastName: string; company: string; createdAt: string; _count?: { uploads: number } };
type RuleEntry = { key: string; label: string; value: string; updatedAt: string };

/* ── Access Logs Tab ─────────────────────────────── */
function LogsTab({ token }: { token: string }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/logs?limit=200", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setLogs(data.logs || []);
    }
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p style={{ color: "var(--muted)" }}>Loading…</p>;

  return (
    <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th>Time</th><th>IP</th><th>Region</th><th>Path</th><th>File</th><th>User ID</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.id}>
              <td>{new Date(l.createdAt).toLocaleString()}</td>
              <td>{l.ip}</td>
              <td>{l.region || "—"}</td>
              <td>{l.path}</td>
              <td>{l.fileName || "—"}</td>
              <td style={{ fontSize: 11 }}>{l.userId || "anon"}</td>
            </tr>
          ))}
          {!logs.length && (
            <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)" }}>No logs yet</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ── Users Tab ───────────────────────────────────── */
function UsersTab({ token }: { token: string }) {
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/users", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users || []);
    }
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p style={{ color: "var(--muted)" }}>Loading…</p>;

  return (
    <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th>Name</th><th>Email</th><th>Company</th><th>Uploads</th><th>Registered</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.firstName} {u.lastName}</td>
              <td>{u.email}</td>
              <td>{u.company || "—"}</td>
              <td>{u._count?.uploads ?? 0}</td>
              <td>{new Date(u.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
          {!users.length && (
            <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--muted)" }}>No users yet</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ── AI Rules Tab ────────────────────────────────── */
function RulesTab({ token }: { token: string }) {
  const [rules, setRules] = useState<RuleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newValue, setNewValue] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/rules", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setRules(data.rules || []);
    }
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const save = async (key: string, value: string, label?: string) => {
    await fetch("/api/admin/rules", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ key, value, label }),
    });
    load();
  };

  const remove = async (key: string) => {
    if (!confirm(`Delete rule "${key}"?`)) return;
    await fetch("/api/admin/rules", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    load();
  };

  const addNew = async () => {
    if (!newKey.trim() || !newValue.trim()) return;
    await save(newKey.trim(), newValue.trim(), newLabel.trim() || newKey.trim());
    setNewKey("");
    setNewLabel("");
    setNewValue("");
  };

  if (loading) return <p style={{ color: "var(--muted)" }}>Loading…</p>;

  return (
    <div>
      <p style={{ color: "var(--muted)", fontSize: 13, margin: "0 0 12px" }}>
        AI rules are injected into prompts at runtime. Edit values below; changes take effect immediately.
      </p>
      {rules.map((r) => (
        <RuleEditor key={r.key} rule={r} onSave={save} onDelete={remove} />
      ))}

      <div style={{ ...styles.ruleCard, borderColor: "var(--accent)" }}>
        <h4 style={{ margin: "0 0 8px", color: "var(--accent)" }}>+ Add New Rule</h4>
        <input placeholder="Key (e.g. gemini_system_prompt)" value={newKey} onChange={(e) => setNewKey(e.target.value)} style={{ ...styles.input, marginBottom: 6 }} />
        <input placeholder="Label" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} style={{ ...styles.input, marginBottom: 6 }} />
        <textarea placeholder="Value" value={newValue} onChange={(e) => setNewValue(e.target.value)} rows={4} style={{ ...styles.input, resize: "vertical" as const }} />
        <button onClick={addNew} style={{ ...styles.btn, marginTop: 8 }}>Add Rule</button>
      </div>
    </div>
  );
}

function RuleEditor({ rule, onSave, onDelete }: { rule: RuleEntry; onSave: (k: string, v: string, l?: string) => void; onDelete: (k: string) => void }) {
  const [value, setValue] = useState(rule.value);
  const [dirty, setDirty] = useState(false);

  return (
    <div style={styles.ruleCard}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div>
          <strong style={{ color: "var(--accent)" }}>{rule.label || rule.key}</strong>
          <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 8 }}>({rule.key})</span>
        </div>
        <button onClick={() => onDelete(rule.key)} style={{ ...styles.btn, background: "#522", fontSize: 11, padding: "3px 8px" }}>Delete</button>
      </div>
      <textarea
        value={value}
        onChange={(e) => { setValue(e.target.value); setDirty(true); }}
        rows={6}
        style={{ ...styles.input, resize: "vertical" as const, fontFamily: "monospace", fontSize: 12 }}
      />
      {dirty && (
        <button onClick={() => { onSave(rule.key, value); setDirty(false); }} style={{ ...styles.btn, marginTop: 6 }}>
          Save Changes
        </button>
      )}
      <p style={{ fontSize: 10, color: "var(--muted)", margin: "4px 0 0" }}>
        Last updated: {new Date(rule.updatedAt).toLocaleString()}
      </p>
    </div>
  );
}

/* ── Report Training Tab ─────────────────────────── */
function ReportTrainingTab({ token }: { token: string }) {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/rules", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      const rule = (data.rules || []).find((r: RuleEntry) => r.key === "gemini_report_examples");
      if (rule) {
        setValue(rule.value);
        setUpdatedAt(rule.updatedAt);
      }
    }
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    await fetch("/api/admin/rules", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "gemini_report_examples",
        value,
        label: "Report Style Examples (Few-Shot Training)",
      }),
    });
    setDirty(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    load();
  };

  if (loading) return <p style={{ color: "var(--muted)" }}>Loading…</p>;

  return (
    <div>
      <p style={{ color: "var(--muted)", fontSize: 13, margin: "0 0 8px" }}>
        Paste example reports below to teach the AI assistant how CC Explorations presents findings to clients.
        These examples are injected into the system prompt as few-shot training — the AI will mimic this tone, structure, and terminology.
      </p>
      <p style={{ color: "var(--muted)", fontSize: 12, margin: "0 0 12px" }}>
        <strong>Format:</strong> Include full example reports with headers, depth tables, rankings, and recommendations.
        Separate examples with <code>=== EXAMPLE N: Title ===</code> headers. Include a <code>CLIENT QUESTION:</code> and the corresponding <code>CC EXPLORATIONS REPORT:</code> for each.
      </p>
      <textarea
        value={value}
        onChange={(e) => { setValue(e.target.value); setDirty(true); }}
        rows={28}
        style={{ ...styles.input, resize: "vertical" as const, fontFamily: "monospace", fontSize: 12, lineHeight: "1.5" }}
        placeholder={"=== EXAMPLE 1: Gold Survey (Site Name) ===\n\nCLIENT QUESTION: \"Analyze the AMRT results for this site.\"\n\nCC EXPLORATIONS REPORT:\n\n# AMRT Survey Report — Site Name\n\n## 1. Survey Overview\n...\n\n## 2. Identified Structures\n...\n\n## 3. Recommendations\n1. ...\n2. ..."}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
        {dirty && (
          <button onClick={save} style={styles.btn}>
            Save Report Examples
          </button>
        )}
        {saved && <span style={{ color: "#4ade80", fontSize: 13 }}>Saved! Changes take effect immediately.</span>}
      </div>
      {updatedAt && (
        <p style={{ fontSize: 10, color: "var(--muted)", margin: "8px 0 0" }}>
          Last updated: {new Date(updatedAt).toLocaleString()}
        </p>
      )}
      <div style={{ ...styles.ruleCard, marginTop: 16, borderColor: "rgba(46, 168, 255, 0.3)" }}>
        <h4 style={{ margin: "0 0 8px", color: "var(--accent)" }}>Tips for Effective Report Training</h4>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: "var(--muted)", lineHeight: "1.7" }}>
          <li>Include 2–5 complete example reports covering different resource types (Au, Oil, Cu, H2O, Void)</li>
          <li>Each example should show the client question and the full expected report</li>
          <li>Use real data from CC Explorations surveys — entity names, depth ranges, coordinates</li>
          <li>Include the standard report sections: Survey Overview, Structures, Interpretation, Recommendations</li>
          <li>Add a &quot;Reporting Style Notes&quot; section at the end for general style rules</li>
          <li>The AI will match the tone, detail level, and terminology from these examples</li>
        </ul>
      </div>
    </div>
  );
}

/* ── Styles ──────────────────────────────────────── */
const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "radial-gradient(circle at 20% 0%, #0e1727 0%, #03070e 45%)",
    color: "#e7eef8",
    fontFamily: "'IBM Plex Sans', 'Segoe UI', sans-serif",
    display: "flex",
    justifyContent: "center",
    padding: 32,
    overflow: "auto",
  },
  loginBox: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    background: "rgba(8,12,18,0.9)",
    border: "1px solid rgba(137,168,201,0.22)",
    borderRadius: 12,
    padding: 32,
    maxWidth: 360,
    width: "100%",
    alignSelf: "flex-start",
    marginTop: 80,
  },
  container: {
    maxWidth: 1100,
    width: "100%",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  tabs: {
    display: "flex",
    gap: 0,
    borderBottom: "1px solid rgba(137,168,201,0.22)",
    marginBottom: 20,
  },
  tab: {
    padding: "10px 20px",
    background: "none",
    border: "none",
    borderBottom: "2px solid transparent",
    color: "#9db0c8",
    cursor: "pointer",
    fontSize: 14,
    fontFamily: "inherit",
  },
  tabActive: {
    color: "#2ea8ff",
    borderBottomColor: "#2ea8ff",
  },
  input: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(137,168,201,0.22)",
    borderRadius: 6,
    color: "#e7eef8",
    padding: "8px 12px",
    fontSize: 14,
    fontFamily: "inherit",
    width: "100%",
    outline: "none",
  },
  btn: {
    background: "#2ea8ff",
    border: "none",
    borderRadius: 6,
    color: "#fff",
    padding: "8px 18px",
    cursor: "pointer",
    fontSize: 14,
    fontFamily: "inherit",
  },
  tableWrap: {
    overflowX: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  },
  ruleCard: {
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(137,168,201,0.15)",
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
  },
};

// Simple table styling via global string (inserted once)
const tableCSS = `
  .admin-page table th, .admin-page table td {
    padding: 8px 12px;
    border-bottom: 1px solid rgba(137,168,201,0.12);
    text-align: left;
  }
  .admin-page table th { color: #9db0c8; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
`;

if (typeof document !== "undefined" && !document.getElementById("admin-css")) {
  const s = document.createElement("style");
  s.id = "admin-css";
  s.textContent = tableCSS;
  document.head.appendChild(s);
}
