'use client';

import { useTheme } from './ThemeProvider';
import { Sun, Moon, Monitor } from '@phosphor-icons/react';
import { Segmented } from '@/components/ui/segmented';

type Theme = 'light' | 'dark' | 'system';

/**
 * All three states, visible at once, with the thumb moving between them.
 *
 * This used to render `{theme}` as its own label, so the button displayed its
 * current *value* and never its *function*: "System" is the answer to a question
 * the control never asks. It also cycled, so nothing indicated that pressing it
 * would move you to Light rather than Dark.
 *
 * It shares the Segmented primitive with Reverse lookup rather than being a
 * second implementation of the same idea. The keyboard pattern and the sliding
 * thumb come with it, which is the point: the two controls had already drifted
 * apart once.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const current = (theme as Theme) ?? 'system';

  const icon = (Icon: typeof Sun, value: Theme) => (
    <Icon className="h-4 w-4" weight={current === value ? 'fill' : 'regular'} aria-hidden />
  );

  return (
    <Segmented<Theme>
      ariaLabel="Colour theme"
      value={current}
      onChange={setTheme}
      className="w-[7.5rem]"
      options={[
        { value: 'light', label: 'Light', content: icon(Sun, 'light') },
        { value: 'dark', label: 'Dark', content: icon(Moon, 'dark') },
        { value: 'system', label: 'System', content: icon(Monitor, 'system') },
      ]}
    />
  );
}
