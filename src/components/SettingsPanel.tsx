"use client";


import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useGeoData } from "@/context/GeoDataContext";

export interface JoystickSettings {
  moveSpeed: number;
  zoomSpeed: number;
  rotateSpeed: number;
  deadZone: number;
  damping: number;
  showJoysticks: boolean;
  joystickOpacity: number;
  invertY: boolean;
  mouseSensitivity: number;
}

export const DEFAULTS: JoystickSettings = {
  moveSpeed: 1.0,
  zoomSpeed: 1.0,
  rotateSpeed: 1.0,
  deadZone: 0.08,
  damping: 0.22,
  showJoysticks: true,
  joystickOpacity: 1.0,
  invertY: false,
  mouseSensitivity: 1.0,
};

const STORAGE_KEY = "cc-geolab-joystick-settings";

function loadSettings(): JoystickSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* use defaults */ }
  return { ...DEFAULTS };
}

function saveSettings(s: JoystickSettings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* noop */ }
}

declare global {
  interface Window { __joystickSettings?: JoystickSettings; }
}

function publishSettings(s: JoystickSettings) {
  window.__joystickSettings = s;
  document.querySelectorAll(".dj-wrap").forEach((el) => {
    const wrap = el as HTMLElement;
    wrap.style.display = s.showJoysticks ? "" : "none";
    wrap.style.opacity = String(s.joystickOpacity);
  });
}

const sl: React.CSSProperties = { width: "100%", accentColor: "#4af" };
const lbl: React.CSSProperties = { display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 2, color: "#ccc" };
const sep: React.CSSProperties = { borderTop: "1px solid #444", margin: "8px 0" };
const sec: React.CSSProperties = { fontSize: 9, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 };

function Slider({ label, value, min, max, step, unit, onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={lbl}><span>{label}</span><span style={{ color: "#4af" }}>{value.toFixed(2)}{unit || ""}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} style={sl} />
    </div>
  );
}

export default function SettingsPanel() {
  const { user } = useGeoData();
  const [settings, setSettings] = useState<JoystickSettings>(DEFAULTS);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [preset, setPreset] = useState<JoystickSettings | null>(null);
  const [source, setSource] = useState<string>("default");
  const [msg, setMsg] = useState<string>("");

  // Fetch settings (user or preset) on mount
  useEffect(() => {
    let cancelled = false;
    async function fetchSettings() {
      setLoading(true);
      setMsg("");
      try {
        const headers: Record<string, string> = {};
        if (user?.id) headers["x-user-id"] = user.id;
        const res = await fetch("/api/settings/joystick", { headers });
        const data = await res.json();
        if (!cancelled) {
          if (data.settings) {
            setSettings({ ...DEFAULTS, ...data.settings });
            publishSettings({ ...DEFAULTS, ...data.settings });
            setSource(data.source || "default");
          } else {
            setSettings({ ...DEFAULTS });
            publishSettings(DEFAULTS);
            setSource("default");
          }
        }
      } catch {
        if (!cancelled) {
          setSettings({ ...DEFAULTS });
          publishSettings(DEFAULTS);
          setSource("default");
        }
      }
      setLoading(false);
    }
    fetchSettings();
    // Wait for CesiumKMZ to render #settingsBody
    const poll = setInterval(() => {
      const el = document.getElementById("settingsBody");
      if (el) { setTarget(el); clearInterval(poll); }
    }, 200);
    return () => { cancelled = true; clearInterval(poll); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Fetch preset for admin
  useEffect(() => {
    async function checkAdminAndFetchPreset() {
      if (!user?.email) return;
      // crude: treat any user with email ending in admin as admin
      if (/admin/i.test(user.email)) setIsAdmin(true);
      try {
        const res = await fetch("/api/settings/joystick/preset");
        const data = await res.json();
        if (data.settings) setPreset({ ...DEFAULTS, ...data.settings });
      } catch {}
    }
    checkAdminAndFetchPreset();
  }, [user]);

  async function update(patch: Partial<JoystickSettings>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      publishSettings(next);
      if (user?.id) {
        // Save to server
        fetch("/api/settings/joystick", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-user-id": user.id },
          body: JSON.stringify(next),
        }).then(() => setMsg("Saved!"));
      } else {
        // Guest: local only
        saveSettings(next);
      }
      return next;
    });
  }

  async function resetDefaults() {
    setMsg("");
    setLoading(true);
    // Reload from API (user or preset)
    try {
      const headers: Record<string, string> = {};
      if (user?.id) headers["x-user-id"] = user.id;
      const res = await fetch("/api/settings/joystick", { headers });
      const data = await res.json();
      if (data.settings) {
        setSettings({ ...DEFAULTS, ...data.settings });
        publishSettings({ ...DEFAULTS, ...data.settings });
        setSource(data.source || "default");
      } else {
        setSettings({ ...DEFAULTS });
        publishSettings(DEFAULTS);
        setSource("default");
      }
    } catch {
      setSettings({ ...DEFAULTS });
      publishSettings(DEFAULTS);
      setSource("default");
    }
    setLoading(false);
  }

  async function saveAsPreset() {
    setMsg("");
    try {
      const res = await fetch("/api/settings/joystick/preset", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer ccadmin2026" },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        setMsg("Preset saved!");
        setPreset(settings);
      } else {
        setMsg("Failed to save preset");
      }
    } catch {
      setMsg("Failed to save preset");
    }
  }

  if (!target) return null;

  return createPortal(
    <div
      style={{ fontSize: 12, color: "#fff" }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {loading && <div style={{ color: "#aaa", marginBottom: 8 }}>Loading settings…</div>}
      {msg && <div style={{ color: "#4af", marginBottom: 8 }}>{msg}</div>}
      <div style={{ color: "#888", fontSize: 10, marginBottom: 4 }}>
        Source: {source}
      </div>
      {/* Visibility */}
      <div style={sec}>Visibility</div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 6, cursor: "pointer" }}>
        <input type="checkbox" checked={settings.showJoysticks} onChange={(e) => update({ showJoysticks: e.target.checked })} style={{ accentColor: "#4af" }} />
        Show on-screen joysticks
      </label>
      <Slider label="Joystick Opacity" value={settings.joystickOpacity} min={0.2} max={1.0} step={0.05} onChange={(v) => update({ joystickOpacity: v })} />

      <div style={sep} />

      {/* Movement */}
      <div style={sec}>Movement</div>
      <Slider label="Move Speed" value={settings.moveSpeed} min={0.1} max={5.0} step={0.1} unit="x" onChange={(v) => update({ moveSpeed: v })} />
      <Slider label="Zoom Speed" value={settings.zoomSpeed} min={0.1} max={5.0} step={0.1} unit="x" onChange={(v) => update({ zoomSpeed: v })} />

      <div style={sep} />

      {/* Rotation */}
      <div style={sec}>Rotation</div>
      <Slider label="Rotate Speed" value={settings.rotateSpeed} min={0.1} max={5.0} step={0.1} unit="x" onChange={(v) => update({ rotateSpeed: v })} />
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 6, cursor: "pointer" }}>
        <input type="checkbox" checked={settings.invertY} onChange={(e) => update({ invertY: e.target.checked })} style={{ accentColor: "#4af" }} />
        Invert Y axis
      </label>

      <div style={sep} />

      {/* Input Tuning */}
      <div style={sec}>Input Tuning</div>
      <Slider label="Dead Zone" value={settings.deadZone} min={0.0} max={0.3} step={0.01} onChange={(v) => update({ deadZone: v })} />
      <Slider label="Snap-back Damping" value={settings.damping} min={0.05} max={0.6} step={0.01} onChange={(v) => update({ damping: v })} />
      <Slider label="Mouse Sensitivity" value={settings.mouseSensitivity} min={0.2} max={3.0} step={0.1} unit="x" onChange={(v) => update({ mouseSensitivity: v })} />

      <div style={sep} />

      <button
        type="button"
        onClick={resetDefaults}
        style={{
          width: "100%",
          border: "1px solid #555",
          borderRadius: 4,
          padding: "5px 8px",
          background: "transparent",
          color: "#ccc",
          fontSize: 11,
          cursor: "pointer",
          marginBottom: 6,
        }}
      >
        Reset to Defaults
      </button>
      {isAdmin && (
        <button
          type="button"
          onClick={saveAsPreset}
          style={{
            width: "100%",
            border: "1px solid #4af",
            borderRadius: 4,
            padding: "5px 8px",
            background: "#111",
            color: "#4af",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          Save as Preset (Admin)
        </button>
      )}
    </div>,
    target,
  );
}
