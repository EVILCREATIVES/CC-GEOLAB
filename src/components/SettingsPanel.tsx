"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

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

const DEFAULTS: JoystickSettings = {
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
  const [settings, setSettings] = useState<JoystickSettings>(DEFAULTS);
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const s = loadSettings();
    setSettings(s);
    publishSettings(s);

    // Wait for CesiumKMZ to render #settingsBody
    const poll = setInterval(() => {
      const el = document.getElementById("settingsBody");
      if (el) { setTarget(el); clearInterval(poll); }
    }, 200);
    return () => clearInterval(poll);
  }, []);

  function update(patch: Partial<JoystickSettings>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      publishSettings(next);
      return next;
    });
  }

  function resetDefaults() {
    setSettings({ ...DEFAULTS });
    saveSettings(DEFAULTS);
    publishSettings(DEFAULTS);
  }

  if (!target) return null;

  return createPortal(
    <div
      style={{ fontSize: 12, color: "#fff" }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
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
        }}
      >
        Reset to Defaults
      </button>
    </div>,
    target,
  );
}
