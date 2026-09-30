import React, { createContext, useContext, useEffect } from 'react';

export type ThemeMode = 'light' | 'dark';

interface ThemeContextValue {
  theme: ThemeMode;
  toggleTheme: () => void;
  setTheme: (mode: ThemeMode) => void;
}

const THEME_STORAGE_KEY = 'akash_tunnel_theme_mode_v1';

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  toggleTheme: () => {},
  setTheme: () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const theme: ThemeMode = 'light';

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', 'light');
    root.classList.add('light');
    root.classList.remove('dark');
    try {
      localStorage.setItem(THEME_STORAGE_KEY, 'light');
    } catch {
      // Ignore storage errors
    }
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        toggleTheme: () => {},
        setTheme: () => {},
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

interface ThemeToggleButtonProps {
  compact?: boolean;
  isMainWindow?: boolean;
}

export const ThemeToggleButton: React.FC<ThemeToggleButtonProps> = () => {
  // Light mode is enforced across all windows
  return null;
};
