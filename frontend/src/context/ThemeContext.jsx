import { createContext, useContext, useLayoutEffect, useState } from 'react';

const ThemeContext = createContext(null);
const storageKey = 'aura_theme';
const choices = ['system', 'light', 'dark'];

function savedTheme() {
  try {
    const value = localStorage.getItem(storageKey);
    return choices.includes(value) ? value : 'system';
  } catch { return 'system'; }
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(savedTheme);
  useLayoutEffect(() => {
    const system = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const current = theme === 'system' ? (system.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = current;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', current === 'dark' ? '#151419' : '#f7f6fb');
    };
    apply();
    if (theme === 'system') system.addEventListener('change', apply);
    return () => system.removeEventListener('change', apply);
  }, [theme]);

  const chooseTheme = value => {
    if (!choices.includes(value)) return;
    try { localStorage.setItem(storageKey, value); } catch { /* Apply for this session. */ }
    setTheme(value);
  };
  return <ThemeContext.Provider value={{ theme, chooseTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
