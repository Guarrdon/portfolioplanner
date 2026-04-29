/**
 * Strategy registry — the canonical list of strategy classes the UI knows
 * about. Tied 1:1 to backend/app/core/strategy_classes.py. Adding a new
 * strategy means an entry here + a backend constant + (optionally) a KPI
 * panel component.
 *
 * Each entry:
 *   key            — matches the backend strategy_class string
 *   label          — human-facing
 *   tagline        — one-line summary shown on the hub tile
 *   accent         — Tailwind class fragments for the tile's accent color
 *   kpiPanel       — lazy-loaded React component for the detail page (optional)
 */
import {
  TrendingUp, ShieldCheck, DollarSign, GitBranch, Target,
  Rocket, Package, Coins, CalendarClock, Umbrella, Activity,
} from 'lucide-react';

export const STRATEGY_LIST = [
  {
    key: 'long_stock',
    label: 'Long Stock',
    tagline: 'Plain holdings — no calls written.',
    icon: TrendingUp,
    accent: { bar: 'bg-sky-500', tile: 'border-sky-200', text: 'text-sky-800', soft: 'bg-sky-50' },
  },
  {
    key: 'covered_calls',
    label: 'Covered Calls',
    tagline: 'Long stock + short calls. Income, accumulation, or protection.',
    icon: ShieldCheck,
    accent: { bar: 'bg-emerald-500', tile: 'border-emerald-200', text: 'text-emerald-800', soft: 'bg-emerald-50' },
  },
  {
    key: 'dividends',
    label: 'Dividends',
    tagline: 'Income plays around dividend-paying stock.',
    icon: DollarSign,
    accent: { bar: 'bg-teal-500', tile: 'border-teal-200', text: 'text-teal-800', soft: 'bg-teal-50' },
  },
  {
    key: 'verticals',
    label: 'Verticals',
    tagline: 'Debit/credit spreads. Close at various levels.',
    icon: GitBranch,
    accent: { bar: 'bg-indigo-500', tile: 'border-indigo-200', text: 'text-indigo-800', soft: 'bg-indigo-50' },
  },
  {
    key: 'single_leg',
    label: 'Single-leg',
    tagline: 'Single options. Could roll, take, or leave.',
    icon: Target,
    accent: { bar: 'bg-purple-500', tile: 'border-purple-200', text: 'text-purple-800', soft: 'bg-purple-50' },
  },
  {
    key: 'big_options',
    label: 'Big Options',
    tagline: 'Long-premium lottery plays — 10–200 contracts.',
    icon: Rocket,
    accent: { bar: 'bg-fuchsia-500', tile: 'border-fuchsia-200', text: 'text-fuchsia-800', soft: 'bg-fuchsia-50' },
  },
  {
    key: 'box_spreads',
    label: 'Box Spreads',
    tagline: 'Synthetic financing. Locked-in APR.',
    icon: Package,
    accent: { bar: 'bg-amber-500', tile: 'border-amber-200', text: 'text-amber-800', soft: 'bg-amber-50' },
  },
  {
    key: 'cash_mgmt',
    label: 'Cash Management',
    tagline: 'Excess cash optimization — MMF, BIL, treasuries.',
    icon: Coins,
    accent: { bar: 'bg-yellow-500', tile: 'border-yellow-200', text: 'text-yellow-800', soft: 'bg-yellow-50' },
  },
  {
    key: 'earnings',
    label: 'Earnings',
    tagline: 'Short-term plays around announcements.',
    icon: CalendarClock,
    accent: { bar: 'bg-orange-500', tile: 'border-orange-200', text: 'text-orange-800', soft: 'bg-orange-50' },
  },
  {
    key: 'hedge',
    label: 'Hedge',
    tagline: 'Timed PM-risk reduction. VIX, ratios, etc.',
    icon: Umbrella,
    accent: { bar: 'bg-rose-500', tile: 'border-rose-200', text: 'text-rose-800', soft: 'bg-rose-50' },
  },
  {
    key: 'futures',
    label: 'Futures',
    tagline: 'Long/short futures, often overnight holds.',
    icon: Activity,
    accent: { bar: 'bg-red-500', tile: 'border-red-200', text: 'text-red-800', soft: 'bg-red-50' },
  },
];

export const STRATEGY_BY_KEY = Object.fromEntries(STRATEGY_LIST.map((s) => [s.key, s]));

export const getStrategy = (key) => STRATEGY_BY_KEY[key] || null;

// Position-level `strategy_type` (auto-detected from leg shape, singular —
// see backend/app/core/strategy_types.py) → Group-level `strategy_class`
// (plural, the 11 user-facing areas). Use this to bucket positions in
// portfolio-wide charts so colors/labels/links match the strategies hub.
//
// `short_stock` rolls into `long_stock` (single Long Stock area in the hub).
// Customs (wheel_strategy, iron_condor, calendar_spread, …) and unknowns
// resolve to null — caller decides whether to bucket as "unclassified" or
// drop them.
const STRATEGY_TYPE_TO_CLASS = {
  long_stock: 'long_stock',
  short_stock: 'long_stock',
  covered_call: 'covered_calls',
  vertical_spread: 'verticals',
  box_spread: 'box_spreads',
  big_option: 'big_options',
  single_option: 'single_leg',
};

export const strategyTypeToClass = (type) => STRATEGY_TYPE_TO_CLASS[type] || null;
