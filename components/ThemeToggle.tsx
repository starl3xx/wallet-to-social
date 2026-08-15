'use client';

import { useTheme } from './ThemeProvider';
import { Sun, Moon, Monitor } from '@phosphor-icons/react';

const OPTIONS = [
  { value: 'light' as const, label: 'Light', Icon: Sun },
  { value: 'dark' as const, label: 'Dark', Icon: Moon },
  { value: 'system' as const, label: 'System', Icon: Monitor },
];

/**
 * All three states, visible at once.
 *
 * This used to render `{theme}` as its own label, so the button displayed its
 * current *value* and never its *function*: "System" is the answer to a question
 * the control never asks. It also cycled, so nothing indicated that pressing it
 * would move you to Light rather than Dark.
 *
 * A control with four or fewer states shows them all. That removes the label
 * entirely, since three recognisable glyphs say more than one word did, and it
 * reuses the segmented pill already in ReverseLookup rather than inventing a
 * second pattern for the same job.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="inline-flex h-10 items-center gap-0.5 rounded-full bg-muted p-1"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={`transition-control flex h-8 w-9 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
              active
                ? 'bg-background text-accent-brand'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4" weight={active ? 'fill' : 'regular'} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
