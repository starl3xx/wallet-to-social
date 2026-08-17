'use client';

import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/eyebrow';
import {
  Gauge,
  ChartBar as BarChart3,
  TrendUp as TrendingUp,
  CurrencyDollar as DollarSign,
  Wrench,
  Sparkle as Sparkles,
  Briefcase,
  ClockCounterClockwise as History,
  Users,
  // `PencilSimple`, not `Pencil`: they are different glyphs, and the page was
  // rendering this one.
  PencilSimple as Pencil,
  WarningCircle,
  type Icon,
} from '@phosphor-icons/react';

export type AdminTab =
  | 'pulse'
  | 'behavior'
  | 'growth'
  | 'revenue'
  | 'health'
  | 'usage'
  | 'whitelist'
  | 'dashboard'
  | 'jobs'
  | 'history'
  | 'users'
  | 'enrichment'
  | 'conflicts';

interface NavItem {
  value: AdminTab;
  label: string;
  icon: Icon;
}

/**
 * Two groups, twelve destinations. Previously twelve `Button` elements written
 * out longhand in the page, in two `flex ... overflow-x-auto` strips.
 *
 * The strips were the defect. The design language is explicit that a content
 * strip never scrolls sideways and reflows as a responsive grid, with
 * `overflow-x-auto` reserved for a genuine data table. A sideways scrollbar
 * hides destinations behind a gesture people do not know is available, and on a
 * narrow screen it hid half of them.
 */
const ANALYTICS: NavItem[] = [
  { value: 'pulse', label: 'Pulse', icon: Gauge },
  { value: 'behavior', label: 'Behavior', icon: BarChart3 },
  { value: 'growth', label: 'Growth', icon: TrendingUp },
  { value: 'revenue', label: 'Revenue', icon: DollarSign },
  { value: 'health', label: 'Health', icon: Wrench },
];

const OPERATIONS: NavItem[] = [
  { value: 'whitelist', label: 'Whitelist', icon: Sparkles },
  { value: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { value: 'jobs', label: 'Jobs', icon: Briefcase },
  { value: 'history', label: 'Saved lookups', icon: History },
  { value: 'users', label: 'Users', icon: Users },
  { value: 'usage', label: 'Usage', icon: Gauge },
  { value: 'enrichment', label: 'Enrichment', icon: Pencil },
  { value: 'conflicts', label: 'Conflicts', icon: WarningCircle },
];

function NavGroup({
  title,
  items,
  active,
  onSelect,
}: {
  title: string;
  items: NavItem[];
  active: AdminTab;
  onSelect: (tab: AdminTab) => void;
}) {
  return (
    /**
     * `nav` with a name, rather than `role="tablist"`. These are two separately
     * labelled groups pointing at one content region, which is navigation
     * rather than one tab strip, and calling it a tablist would promise a
     * roving focus and arrow keys that this shape does not want. A landmark per
     * group gives a screen reader a way past twelve controls that a fake
     * tablist would not.
     */
    <nav aria-label={title}>
      <Eyebrow as="h2" className="mb-2">
        {title}
      </Eyebrow>
      {/* Reflows rather than scrolls, and steps in exactly the places the Pulse
          tile grid beneath it does, so the two read as one rhythm.

          One step the tiles do not have: a single column below `xs`. A tile's
          label wraps, a Button's does not, so at a 320px screen the two-across
          cell is 132px and "Saved lookups" needs 138 and spilled out of the
          pill. Measured with the real typeface; at 360px the cell is 152px and
          every label fits. */}
      <div className="grid grid-cols-1 gap-2 xs:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        {items.map((item) => {
          const Icon = item.icon;
          const current = active === item.value;
          return (
            <Button
              key={item.value}
              variant={current ? 'default' : 'outline'}
              size="sm"
              // `aria-current` states which destination you are on. The filled
              // variant says it visually; without this it says it only to
              // people who can see the fill.
              aria-current={current ? 'page' : undefined}
              onClick={() => onSelect(item.value)}
              className="w-full"
            >
              <Icon className="h-4 w-4" aria-hidden />
              {item.label}
            </Button>
          );
        })}
      </div>
    </nav>
  );
}

export function AdminNav({
  active,
  onSelect,
}: {
  active: AdminTab;
  onSelect: (tab: AdminTab) => void;
}) {
  return (
    <div className="mb-8 space-y-4">
      <NavGroup title="Analytics" items={ANALYTICS} active={active} onSelect={onSelect} />
      <NavGroup title="Operations" items={OPERATIONS} active={active} onSelect={onSelect} />
    </div>
  );
}
