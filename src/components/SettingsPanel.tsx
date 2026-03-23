"use client";

import { useEffect, useState } from "react";

export interface JoystickSettings {
  moveSpeed: number;       // multiplier on BASE_STRAFE (default 1.0)
  zoomSpeed: number;       // multiplier on zoomStep   (default 1.0)
  rotateSpeed: number;     // multiplier on YAW/PITCH  (default 1.0)
  deadZone: number;        // 0–0.3                    (default 0.08)
  damping: number;         // 0.05–0.6                 (default 0.22)
  showJoysticks: boolean;  //                          (default true)
  joystickOpacity: number; // 0.2–1.0                  (default 1.0)
  invertY: boolean;        //                          (default false)
  mouseSensitivity: number;// multiplier               (default 1.0)
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
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed };
    }
  } catch { /* use defaults */ }
  return { ...DEFAULTS };
}

function saveSettings(s: JoystickSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch { /* noop */ }
}

// Expose globally so CesiumKMZ can read live values
declare global {
  interface Window {
    __joystickSettings?: JoystickSettings;
  }
}

function publishSettings(s: JoystickSettings) {
  window.__joystickSettings = s;
  // Toggle joystick visibility
  document.querySelectorAll(".dj-wrap").forEach((el) => {
    const wrap = el as HTMLElement;
    wrap.style.display = s.showJoysticks ? "" : "none";
    wrap.style.opacity = String(s.joystickOpacity);
  });
}

function GearIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

type SliderRowProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
};

function SliderRow({ label, value, min, max, step, unit, onChange }: SliderRowProps) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
        <span>{label}</span>
        <span style={{ color: "var(--accent)" }}>{value.toFixed(2)}{unit || ""}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: "var(--accent)" }}
      />
    </div>
  );
}

export default function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<JoystickSettings>(DEFAULTS);

  // Load from localStorage on mount
  useEffect(() => {
    const s = loadSettings();
    setSettings(s);
    publishSettings(s);
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

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open Settings"
        style={{
          position: "absolute",
          right: 14,
          top: 14,
          zIndex: 10050,
          width: 44,
          height: 44,
          borderRadius: "50%",
          border: "1px solid var(--line)",
          background: "var(--panel)",
          backdropFilter: "blur(8px)",
          color: "var(--text)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 4px 16px rgba(0,0,0,.45)",
          padding: 0,
        }}
      >
        <GearIcon />
      </button>
    );
  }

  return (
    <aside
      style={{
        position: "absolute",
        right: 14,
        top: 14,
        zIndex: 10050,
        width: "min(320px, calc(100vw - 28px))",
        maxHeight: "calc(100vh - 28px)",
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 14,
        backdropFilter: "blur(8px)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontWeight: 700, letterSpacing: 0.3, display: "flex", alignItems: "center", gap: 8 }}>
          <GearIcon size={18} />
          Joystick Settings
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close settings"
          style={{ background: "transparent", border: "none", color: "var(--muted)", fontSize: 20, cursor: "pointer", padding: "4px 8px", lineHeight: 1 }}
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px" }}>
        {/* Visibility */}
        <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Visibility</div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 10, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={settings.showJoysticks}
            onChange={(e) => update({ showJoysticks: e.target.checked })}
            style={{ accentColor: "var(--accent)" }}
          />
          Show on-screen joysticks
        </label>
        <SliderRow label="Joystick Opacity" value={settings.joystickOpacity} min={0.2} max={1.0} step={0.05} onChange={(v) => update({ joystickOpacity: v })} />

        <div style={{ borderTop: "1px solid var(--line)", margin: "10px 0" }} />

        {/* Movement */}
        <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Movement</div>
        <SliderRow label="Move Speed" value={settings.moveSpeed} min={0.1} max={5.0} step={0.1} unit="x" onChange={(v) => update({ moveSpeed: v })} />
        <SliderRow label="Zoom Speed" value={settings.zoomSpeed} min={0.1} max={5.0} step={0.1} unit="x" onChange={(v) => update({ zoomSpeed: v })} />

        <div style={{ borderTop: "1px solid var(--line)", margin: "10px 0" }} />

        {/* Rotation */}
        <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Rotation</div>
        <SliderRow label="Rotate Speed" value={settings.rotateSpeed} min={0.1} max={5.0} step={0.1} unit="x" onChange={(v) => update({ rotateSpeed: v })} />
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 10, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={settings.invertY}
            onChange={(e) => update({ invertY: e.target.checked })}
            style={{ accentColor: "var(--accent)" }}
          />
          Invert Y axis
        </label>

        <div style={{ borderTop: "1px solid var(--line)", margin: "10px 0" }} />

        {/* Input Tuning */}
        <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Input Tuning</div>
        <SliderRow label="Dead Zone" value={settings.deadZone} min={0.0} max={0.3} step={0.01} onChange={(v) => update({ deadZone: v })} />
        <SliderRow label="Snap-back Damping" value={settings.damping} min={0.05} max={0.6} step={0.01} onChange={(v) => update({ damping: v })} />
        <SliderRow label="Mouse Sensitivity" value={settings.mouseSensitivity} min={0.2} max={3.0} step={0.1} unit="x" onChange={(v) => update({ mouseSensitivity: v })} />
      </div>

      {/* Footer */}
      <div style={{ borderTop: "1px solid var(--line)", padding: "10px 14px" }}>
        <button
          type="button"
          onClick={resetDefaults}
          style={{
            width: "100%",
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: "8px 12px",
            background: "transparent",
            color: "var(--text)",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Reset to Defaults
        </button>
      </div>
    </aside>
  );
}
