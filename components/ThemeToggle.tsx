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

  /**
   * One weight for all three, always regular.
   *
   * The selected icon used to switch to `fill`, which the design language
   * reserves for status dots and which at 16px turns Monitor into a solid slab
   * that reads as a smudge beside a line-drawn sun and moon. Selection is
   * already carried by the thumb moving under the icon and by the colour
   * change; a third signal only made the row look inconsistent.
   */
  const icon = (Icon: typeof Sun) => <Icon className="h-4 w-4" aria-hidden />;

  return (
    <Segmented<Theme>
      ariaLabel="Colour theme"
      value={current}
      onChange={setTheme}
      className="w-[8.25rem]"
      options={[
        // Light, System, Dark. System sits in the middle because it is the
        // default and because it is the midpoint of what the other two mean:
        // reading left to right now moves from one extreme through "whatever
        // the machine says" to the other, instead of listing two states and
        // then a third thing that is not a state at all.
        { value: 'light', label: 'Light', content: icon(Sun) },
        { value: 'system', label: 'System', content: icon(Monitor) },
        { value: 'dark', label: 'Dark', content: icon(Moon) },
      ]}
    />
  );
}
