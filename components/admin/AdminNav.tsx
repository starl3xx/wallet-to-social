'use client';

import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/eyebrow';
import {
  Gauge,
  ChartBar as BarChart3,
  ChartLineUp,
  TrendUp as TrendingUp,
  CurrencyDollar as DollarSign,
  Wrench,
  Briefcase,
  Users,
  // `PencilSimple`, not `Pencil`: they are different glyphs, and the page was
  // rendering this one.
  PencilSimple as Pencil,
  Eraser,
  type Icon,
} from '@phosphor-icons/react';

export type AdminTab =
  | 'pulse'
  | 'funnel'
  | 'growth'
  | 'revenue'
  | 'health'
  | 'usage'
  | 'records'
  | 'accounts'
  | 'data'
  | 'removal';

interface NavItem {
  value: AdminTab;
  label: string;
  icon: Icon;
}

/**
 * Two groups, ten destinations, one question each.
 *
 * It was thirteen, and the problem was never the count: four pairs answered
 * the same question in two places, so the panel's own navigation could not tell
 * you where an answer lived.
 *
 * | was                          | is       | why                                                    |
 * | ---------------------------- | -------- | ------------------------------------------------------ |
 * | Behavior + Revenue           | Funnel   | both drew a funnel, over different windows and bases    |
 * | Behavior (rest) + Growth     | Growth   | cohorts, retention and adoption are one question        |
 * | Lookups + Usage              | Usage    | both counted lookups and wallets by period              |
 * | Jobs + Saved lookups         | Records  | two lists of the same runs                              |
 * | Users + Whitelist            | Accounts | a whitelist grant is an entitlement on an account       |
 * | Enrichment + Conflicts       | Data     | both are social-graph quality work                      |
 *
 * Each label is the words the pane puts in its own heading, and each icon
 * serves one destination. Both had drifted before: "Dashboard" opened a pane
 * headed "Usage metrics" inside a page whose h1 is "Admin dashboard", and
 * `Gauge` stood for two destinations while `ChartBar` stood for two more, so
 * the icon told you nothing the label had not.
 *
 * The grid never scrolls sideways. The design language is explicit that a
 * content strip reflows as a responsive grid, with `overflow-x-auto` reserved
 * for a genuine data table: a sideways scrollbar hides destinations behind a
 * gesture people do not know is available, and on a narrow screen it hid half
 * of them.
 */
const ANALYTICS: NavItem[] = [
  { value: 'pulse', label: 'Pulse', icon: Gauge },
  { value: 'funnel', label: 'Funnel', icon: BarChart3 },
  { value: 'growth', label: 'Growth', icon: TrendingUp },
  { value: 'revenue', label: 'Revenue', icon: DollarSign },
  { value: 'health', label: 'Health', icon: Wrench },
];

const OPERATIONS: NavItem[] = [
  { value: 'usage', label: 'Usage', icon: ChartLineUp },
  { value: 'records', label: 'Records', icon: Briefcase },
  { value: 'accounts', label: 'Accounts', icon: Users },
  { value: 'data', label: 'Data', icon: Pencil },
  { value: 'removal', label: 'Removal', icon: Eraser },
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

          Two columns from `xs` rather than one. The single-column step existed
          for "Saved lookups", which at a 320px screen needed 138px inside a
          132px cell and spilled out of the pill; the longest label is now
          "Accounts" and fits at every step. `lg:grid-cols-5` fills the row
          exactly for the five destinations each group now holds. */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
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
      <NavGroup
        title="Analytics"
        items={ANALYTICS}
        active={active}
        onSelect={onSelect}
      />
      <NavGroup
        title="Operations"
        items={OPERATIONS}
        active={active}
        onSelect={onSelect}
      />
    </div>
  );
}
