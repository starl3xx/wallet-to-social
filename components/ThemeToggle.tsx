'use client';

import { useTheme } from './ThemeProvider';
import { Sun, Moon, Monitor } from 'lucide-react';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const cycleTheme = () => {
    if (theme === 'system') setTheme('light');
    else if (theme === 'light') setTheme('dark');
    else setTheme('system');
  };

  return (
    <button
      onClick={cycleTheme}
      className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
      title={`Theme: ${theme}`}
    >
      {theme === 'light' && <Sun className="h-4 w-4" />}
      {theme === 'dark' && <Moon className="h-4 w-4" />}
      {theme === 'system' && <Monitor className="h-4 w-4" />}
      <span className="capitalize">{theme}</span>
    </button>
  );
}
