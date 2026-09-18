# Examples — react-code-organization

Concrete before/after for the rules in [SKILL.md](SKILL.md). Generic React/Next.js unless a
snippet is marked *DevDigest*.

---

## 1. Feature-first layout

```
src/
  app/                          # routing only
    repos/[repoId]/pulls/
      page.tsx                  # thin: composes feature components
      _components/              # route-private, not routable
        PrList/
          PrList.tsx
          PrList.test.tsx       # colocated
          styles.ts
          constants.ts          # shared by this folder only
  features/
    reviews/
      api/get-review.ts         # one hook per resource
      components/FindingCard.tsx
      model/score.ts            # pure domain rules — no React imports
      types.ts
  components/                   # shared UI, second-consumer only
    severity-chip/
  lib/                          # configured third-party integrations
    api.ts
```

Two rules are visible here: `app/` holds routing, and `model/score.ts` has no React import, so it
is unit-testable with no renderer.

**Anti-pattern** — type-first top level:

```
src/
  components/    # every component in the app
  hooks/         # every hook in the app
  utils/         # everything else
```

It scales by file count, not by feature, and it makes "what does this app do?" unanswerable.

---

## 2. Promote on the second consumer

```
# One consumer: stays put
features/reviews/model/format-cost.ts

# A second feature needs it: move up one level, not to a global utils.ts
lib/format-cost.ts
```

Not `utils/index.ts`, and not in anticipation of a second consumer that may never arrive.

---

## 3. Barrel file → direct import

```ts
// ❌ src/components/index.ts re-exporting everything
export * from "./severity-chip";
export * from "./cost-badge";
// …40 more

// ❌ and the cycle this creates inside the directory
// severity-chip/SeverityChip.tsx
import { CostBadge } from "../index";   // index → severity-chip → index

// ✅ import the file you need
import { SeverityChip } from "@/components/severity-chip/SeverityChip";
```

Modules behind a barrel load **eagerly** — the side-effect semantics of ES modules require it — so
tree-shaking does not save you, and test runners don't tree-shake at all.

---

## 4. `enum` → `as const` + union

```ts
// ❌ errors under Node's default type stripping; nominally typed across boundaries
export enum Severity {
  Critical = "CRITICAL",
  Warning = "WARNING",
}

// ✅ value and type share one name; plain JS at runtime
export const Severity = {
  Critical: "CRITICAL",
  Warning: "WARNING",
} as const;
export type Severity = (typeof Severity)[keyof typeof Severity];

// iterate at runtime — the reason to prefer an object over a bare union
Object.values(Severity).map((s) => renderChip(s));
```

*DevDigest:* severities are uppercase strings in the contracts (`CRITICAL`, `WARNING`,
`SUGGESTION`), so the values above match the wire format exactly.

---

## 5. `utils.ts` → domain-named modules

```
# ❌ the name refuses nothing, so it accretes
lib/utils.ts        # formatCost, parseDiff, sleep, isAdmin, slugify, …

# ✅ narrow names with real boundaries
lib/format-cost.ts
lib/diff.ts
features/auth/model/permissions.ts   # domain logic, not generic
```

When a util has grown flags that select per-caller behaviour, inline it back into its callers and
re-derive — don't add another flag:

```ts
// ❌ the decay path
formatCost(value, { compact: true, withCurrency: false, round: 2 });

// ✅ two honest functions
formatCostCompact(value);
formatCostUsd(value);
```

---

## 6. Not a hook

```ts
// ❌ calls no hooks, so the `use` prefix lies and blocks conditional calls
function useSortedFindings(findings: Finding[]) {
  return findings.slice().sort(bySeverity);
}

// ✅ plain function — importable in a plain unit test, callable conditionally
export function getSortedFindings(findings: Finding[]) {
  return findings.slice().sort(bySeverity);
}

// ✅ a real hook: named for a concrete use case, and it calls hooks
export function usePrRuns(prId: string) {
  return useQuery({ queryKey: ["pr-runs", prId], queryFn: () => fetchRuns(prId) });
}
```

Never `useMount` / `useEffectOnce` / `useUpdateEffect` — react.dev marks lifecycle wrappers 🔴.

---

## 7. Split a fat hook into domain + presentation

```ts
// ❌ one hook holding domain rules, transport, cache and toasts
function useSubmitReview(pr: Pr) {
  /* validation rules + mutation + cache invalidation + toast */
}

// ✅ domain rule: pure, no React, no UI imports — passes the Framework and Import tests
export function buildPendingReview(pr: Pr, findings: Finding[]): PendingReview { … }

// ✅ presentation/orchestration: allowed to import useMutation and toast
export function useSubmitReview(pr: Pr) {
  const mutation = useMutation({ mutationFn: submitReview });
  return (findings: Finding[]) => mutation.mutate(buildPendingReview(pr, findings));
}
```

The import-smell test decides the split: `toast` and `useMutation` may appear in the hook, never in
`buildPendingReview`.

---

## 8. Derive, don't sync

```tsx
// ❌ an Effect mirroring server data into state
const [visible, setVisible] = useState<Finding[]>([]);
useEffect(() => {
  setVisible(findings.filter((f) => f.severity === filter));
}, [findings, filter]);

// ✅ compute during render
const visible = findings.filter((f) => f.severity === filter);

// ✅ only if measured expensive — note the callee is a plain, testable function
const visible = useMemo(() => getFiltered(findings, filter), [findings, filter]);
```

---

## 9. Prop drilling → composition, not context

```tsx
// ❌ reaching for context because props go three levels deep
<Layout findings={findings} />   // Layout → Panel → List → Card

// ✅ the missing component, with children as the extension point
<Layout>
  <FindingsList findings={findings} />
</Layout>
```

Context is for theming, current user, routing and genuinely distant consumers — not for shortening
a prop path.

---

## 10. Boolean explosion → `variant`

```tsx
// ❌ 2³ combinations, most impossible
<Chip critical warning suggestion />

// ✅ one enumerated prop
<Chip variant="critical" />
```

Boolean props are for exactly two states, default to `false`, and are named as adjectives
(`disabled`, not `disable`).

---

## 11. RSC boundary at the leaf

```tsx
// ❌ 'use client' at the top of the page: every transitive import ships to the browser
"use client";
export default function PrPage() {
  const [tab, setTab] = useState("findings");
  return <Layout><Findings /><Runs /></Layout>;
}

// ✅ server page, client leaf
export default async function PrPage() {           // Server Component
  const pr = await getPr();                        // server-only data access
  return (
    <Layout>
      <TabsShell>                                  {/* 'use client' — owns the state */}
        <Findings pr={pr} />                       {/* stays on the server */}
      </TabsShell>
    </Layout>
  );
}
```

Two boundary rules at work: code crosses through **imports**, data crosses through **props** and
must be serializable. Passing `<Findings />` as `children` keeps its code off the client graph —
`TabsShell` only ever sees its output.

**Gotcha:** dot-notation compounds break across the boundary. A Server Component importing a client
compound gets a client reference, so `Menu.Item` is `undefined`. Expose the parts as named exports.

---

## 12. Types: colocate, then promote

```ts
// One consumer → same file
type Props = { finding: Finding };

// Several files in one feature → narrowest enclosing scope
// features/reviews/types.ts

// Several packages → a shared package, schema-first
export const Finding = z.object({ severity: Severity, path: z.string() });
export type Finding = z.infer<typeof Finding>;
```

One declaration yields runtime validation *and* the static type, so they cannot drift. *DevDigest:*
this is already the house rule — a schema and its `z.infer` type share one name — but remember
`client/src/vendor/shared` is a separate vendored copy needing a manual mirror.
