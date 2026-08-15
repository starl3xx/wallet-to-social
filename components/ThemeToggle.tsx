'use client';

import { useRef } from 'react';
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
 *
 * The keyboard behaviour is not optional. `role="radiogroup"` is a promise that
 * arrows move between options and the group is a single tab stop; declaring the
 * role without implementing it leaves assistive tech announcing a pattern the
 * control does not honour, which is worse than plain buttons would have been.
 * Hence roving tabindex: only the selected option is reachable by Tab, and
 * arrows move selection from there.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (from: number, delta: number) => {
    const next = (from + delta + OPTIONS.length) % OPTIONS.length;
    setTheme(OPTIONS[next].value);
    refs.current[next]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        move(index, 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        move(index, -1);
        break;
      case 'Home':
        e.preventDefault();
        move(0, 0);
        break;
      case 'End':
        e.preventDefault();
        move(OPTIONS.length - 1, 0);
        break;
    }
  };

  // Nothing is selected until the provider resolves, so keep one tab stop.
  const selectedIndex = Math.max(
    0,
    OPTIONS.findIndex((o) => o.value === theme)
  );

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="inline-flex h-10 items-center gap-0.5 rounded-full bg-muted p-1"
    >
      {OPTIONS.map(({ value, label, Icon }, i) => {
        const active = theme === value;
        return (
          <button
            key={value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            tabIndex={i === selectedIndex ? 0 : -1}
            onKeyDown={(e) => onKeyDown(e, i)}
            onClick={() => setTheme(value)}
            className={`transition-control flex h-8 w-9 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
              active
                ? 'bg-surface-raised text-accent-brand'
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
