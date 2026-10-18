// src/theme/theme.ts
// Light / dark mode. The choice is written onto <html data-theme="..."> and index.css swaps the colours.
// "system" follows the computer's own setting. The choice is remembered in this browser.

import { useState } from "react";

export type ThemeChoice = "light" | "dark" | "system";

const STORAGE_KEY = "lps-beacon:theme";

// Reads the saved choice. Storage can be blocked (private windows), so failures fall back to light.
export function loadTheme(): ThemeChoice {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch {
    // ignore: use the default below
  }
  return "light";
}

export function applyTheme(choice: ThemeChoice) {
  document.documentElement.dataset.theme = choice;
}

// The current choice and a function to change it (applies and saves it).
export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [theme, setThemeState] = useState<ThemeChoice>(loadTheme);

  function setTheme(choice: ThemeChoice) {
    setThemeState(choice);
    applyTheme(choice);
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // ignore: the choice still applies until the page is reloaded
    }
  }

  return [theme, setTheme];
}
