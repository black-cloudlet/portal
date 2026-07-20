"use client";

import { useSyncExternalStore } from "react";

import Icon from "@/components/Icon";

/**
 * Light/Dark theme control for the top bar.
 *
 * The console defaults to following the OS preference (`prefers-color-scheme`).
 * This toggle lets a user override that per-device: it cycles System -> Light
 * -> Dark, persists the choice in `localStorage`, and reflects it by setting
 * `data-theme` on <html> (the CSS in globals.css keys off that attribute). A
 * tiny inline script in the root layout applies the saved choice before first
 * paint, so there is no theme flash on load.
 *
 * The selected mode is read via `useSyncExternalStore` so the button stays in
 * sync with `localStorage` (including changes from another tab) and hydrates
 * cleanly from the server default without a setState-in-effect.
 */
type Mode = "system" | "light" | "dark";

const THEME_KEY = "portal-theme";
const NEXT: Record<Mode, Mode> = { system: "light", light: "dark", dark: "system" };
const ICON: Record<Mode, string> = { system: "monitor", light: "sun", dark: "moon" };
const LABEL: Record<Mode, string> = {
  system: "Theme: system",
  light: "Theme: light",
  dark: "Theme: dark",
};

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function readMode(): Mode {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/** Server render (and hydration) always starts from the OS-default. */
function serverMode(): Mode {
  return "system";
}

function applyMode(mode: Mode) {
  const root = document.documentElement;
  if (mode === "system") delete root.dataset.theme;
  else root.dataset.theme = mode;
}

export default function ThemeToggle() {
  const mode = useSyncExternalStore(subscribe, readMode, serverMode);

  function cycle() {
    const next = NEXT[mode];
    applyMode(next);
    try {
      if (next === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      // ignore (private mode / disabled storage)
    }
    // The `storage` event only fires in *other* tabs; nudge this tab's store.
    window.dispatchEvent(new Event("storage"));
  }

  return (
    <button
      className="iconbtn"
      type="button"
      onClick={cycle}
      title={`${LABEL[mode]} (click to change)`}
      aria-label={`${LABEL[mode]}. Click to change.`}
    >
      <Icon name={ICON[mode]} size={18} />
    </button>
  );
}
