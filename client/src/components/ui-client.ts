"use client";

/**
 * Client boundary for the vendored design system.
 *
 * `src/vendor/ui` uses hooks (useState/useEffect/…) in 10 modules but declares
 * no `"use client"` directive, because it is vendored code we do not edit (see
 * the root AGENTS.md "Do not touch" list). Without a directive the kit cannot
 * be imported from a Server Component at all, and every consumer has to declare
 * the boundary itself.
 *
 * This module is that boundary, declared ONCE in first-party code: import the
 * design system from here rather than from `@devdigest/ui` directly, and the
 * directive travels with it. Nothing in `src/vendor/ui` changes, so a re-vendor
 * cannot silently drop the fix.
 *
 * Enforced by the `no-restricted-imports` rule in `eslint.config.mjs`, which
 * allows `@devdigest/ui` only inside this file.
 *
 * Named re-exports, never `export *`: Next's flight loader rejects `export *`
 * in a "use client" module as soon as a Server Component imports it. A name
 * added to the kit must be listed here before callers can use it; typecheck
 * fails if a listed name disappears from the kit.
 */
export {
  AppFrame,
  AutoTriggerStatus,
  Avatar,
  Badge,
  BarRow,
  Button,
  CAT,
  Card,
  CategoryTag,
  Checkbox,
  Chip,
  CircularScore,
  CommandPalette,
  ConfidenceNum,
  Donut,
  Drawer,
  Dropdown,
  EmptyState,
  ErrorState,
  ExportWizardSteps,
  FormField,
  Icon,
  IconBtn,
  Kbd,
  LineChart,
  LiveLogStream,
  Markdown,
  MetricCard,
  Modal,
  MonoLink,
  NAV,
  NavItem,
  PercentProgress,
  ProgressBar,
  RepoSwitcher,
  SETTINGS_ITEM,
  SETTINGS_SECTIONS,
  SEV,
  SHORTCUTS,
  SearchableSelect,
  SectionLabel,
  SelectInput,
  SeverityBadge,
  ShortcutsHelp,
  Sidebar,
  Skeleton,
  Sparkline,
  Tabs,
  TextInput,
  Textarea,
  Toggle,
  Topbar,
  resolveHref,
} from "@devdigest/ui";
export type {
  ButtonProps,
  Category,
  ChartSeries,
  Command,
  Crumb,
  DonutSegment,
  DropdownItemDef,
  IconName,
  LinkLike,
  LogLine,
  LucideIcon,
  NavGroup,
  NavItemDef,
  RepoSummary,
  Severity,
  ShellContext,
  ShortcutDef,
  TabDef,
} from "@devdigest/ui";
