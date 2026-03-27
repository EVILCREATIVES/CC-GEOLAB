import { useEffect, useState } from "react";
import { JoystickSettings, DEFAULTS } from "@/components/SettingsPanel";

export default function AdminJoystickPresetPanel() {
  const [settings, setSettings] = useState<JoystickSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    async function fetchPreset() {
      setLoading(true);
      setMsg("");
      try {
        const res = await fetch("/api/settings/joystick/preset");
        const data = await res.json();
        if (data.settings) {
          setSettings({ ...DEFAULTS, ...data.settings });
        } else {
          setSettings({ ...DEFAULTS });
        }
      } catch {
        setSettings({ ...DEFAULTS });
      }
      setLoading(false);
    }
    fetchPreset();
  }, []);

  async function update(patch: Partial<JoystickSettings>) {
    setSettings((prev) => ({ ...prev, ...patch }));
  }

  async function resetDefaults() {
    setSettings({ ...DEFAULTS });
    setMsg("");
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
      } else {
        setMsg("Failed to save preset");
      }
    } catch {
      setMsg("Failed to save preset");
    }
  }

  return (
    <div style={{ fontSize: 12, color: "#fff", maxWidth: 400 }}>
      {loading && <div style={{ color: "#aaa", marginBottom: 8 }}>Loading preset…</div>}
      {msg && <div style={{ color: "#4af", marginBottom: 8 }}>{msg}</div>}
      <div style={{ color: "#888", fontSize: 10, marginBottom: 4 }}>Global Joystick Preset</div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 6, cursor: "pointer" }}>
        <input type="checkbox" checked={settings.showJoysticks} onChange={e => update({ showJoysticks: e.target.checked })} style={{ accentColor: "#4af" }} />
        Show on-screen joysticks
      </label>
      <Slider label="Joystick Opacity" value={settings.joystickOpacity} min={0.2} max={1.0} step={0.05} onChange={v => update({ joystickOpacity: v })} />
      <div style={{ borderTop: "1px solid #444", margin: "8px 0" }} />
      <div style={{ fontSize: 9, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>Movement</div>
      <Slider label="Move Speed" value={settings.moveSpeed} min={0.1} max={5.0} step={0.1} unit="x" onChange={v => update({ moveSpeed: v })} />
      <Slider label="Zoom Speed" value={settings.zoomSpeed} min={0.1} max={5.0} step={0.1} unit="x" onChange={v => update({ zoomSpeed: v })} />
      <div style={{ borderTop: "1px solid #444", margin: "8px 0" }} />
      <div style={{ fontSize: 9, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>Rotation</div>
      <Slider label="Rotate Speed" value={settings.rotateSpeed} min={0.1} max={5.0} step={0.1} unit="x" onChange={v => update({ rotateSpeed: v })} />
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 6, cursor: "pointer" }}>
        <input type="checkbox" checked={settings.invertY} onChange={e => update({ invertY: e.target.checked })} style={{ accentColor: "#4af" }} />
        Invert Y axis
      </label>
      <div style={{ borderTop: "1px solid #444", margin: "8px 0" }} />
      <div style={{ fontSize: 9, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>Input Tuning</div>
      <Slider label="Dead Zone" value={settings.deadZone} min={0.0} max={0.3} step={0.01} onChange={v => update({ deadZone: v })} />
      <Slider label="Snap-back Damping" value={settings.damping} min={0.05} max={0.6} step={0.01} onChange={v => update({ damping: v })} />
      <Slider label="Mouse Sensitivity" value={settings.mouseSensitivity} min={0.2} max={3.0} step={0.1} unit="x" onChange={v => update({ mouseSensitivity: v })} />
      <div style={{ borderTop: "1px solid #444", margin: "8px 0" }} />
      <button type="button" onClick={resetDefaults} style={{ width: "100%", border: "1px solid #555", borderRadius: 4, padding: "5px 8px", background: "transparent", color: "#ccc", fontSize: 11, cursor: "pointer", marginBottom: 6 }}>Reset to Defaults</button>
      <button type="button" onClick={saveAsPreset} style={{ width: "100%", border: "1px solid #4af", borderRadius: 4, padding: "5px 8px", background: "#111", color: "#4af", fontSize: 11, cursor: "pointer" }}>Save Preset</button>
    </div>
  );
}

function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void; }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 2, color: "#ccc" }}><span>{label}</span><span style={{ color: "#4af" }}>{value.toFixed(2)}{unit || ""}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))} style={{ width: "100%", accentColor: "#4af" }} />
    </div>
  );
}
