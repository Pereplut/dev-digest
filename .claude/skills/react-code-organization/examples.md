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

---

## 13. `app/` composes; it doesn't hold logic

```
src/
  app/                                   # routing adapter
    (dashboard)/                         # layout topology, not a URL segment
      layout.tsx                         # shell only: chrome, no searchParams, no data→children
      repos/[repoId]/
        page.tsx                         # composes; awaits params
        error.tsx                        # this segment owns its failure
        loading.tsx                      # note: does NOT cover layout.tsx above it
        _components/RepoHeader/           # route-private
    global-error.tsx                     # the only thing that catches root-layout failures
  features/reviews/
    api/get-review.ts                    # data access
    model/score.ts                       # pure domain — no next/* imports
```

`error.tsx` does not wrap the `layout.tsx` in its *own* segment — that's why `global-error.tsx`
exists, and why it needs its own `<html>`/`<body>` and styles.

---

## 14. The `'use client'` boundary as a seam

```tsx
// ❌ directive on the layout: every transitive import ships to the browser
"use client";
export default function Layout({ children }) { … }

// ✅ server layout, client leaf, provider as deep as possible
export default function Layout({ children }) {          // Server Component
  return <ThemeProvider>{children}</ThemeProvider>;     // ThemeProvider is its own 'use client' file
}

// ✅ server content inside a client shell: Modal is the PARENT, not the OWNER
export default async function Page() {
  const cart = await getCart();                          // server-only data access
  return <Modal><Cart data={cart} /></Modal>;            // Cart's code never enters the client graph
}
```

Two rules govern this: **code** crosses through imports and gets bundled; **data** crosses through
props and must be serializable — so event handlers can't cross. Wrap a client-only third-party
component in your own one-line `'use client'` file instead of marking your tree.

**Gotcha:** dot-notation compounds break here. `Menu.Item` is `undefined` across the seam — export
the parts as named exports.

---

## 15. Thin action over a server-only DAL

```ts
// ✅ lib/dal.ts — server-only, authorizes, returns a DTO
import "server-only";
import { cache } from "react";

export const getSession = cache(async () => { /* read cookies, verify */ });

export async function getInvoice(id: string) {
  const session = await getSession();                     // re-read, never passed in as a prop
  const row = await db.invoice.findUnique({ where: { id } });
  if (row?.ownerId !== session.userId) return null;       // authorize the specific resource
  return { id: row.id, total: row.total };                // DTO, not the row
}

// ✅ actions.ts — thin wrapper; a public POST endpoint
"use server";
export async function payInvoice(id: string, amount: number) {
  const parsed = PaySchema.safeParse({ id, amount });     // shape only — NOT authorization
  if (!parsed.success) return { success: false as const, error: "invalid" };
  const invoice = await getInvoice(parsed.data.id);       // ownership re-derived from the session
  if (!invoice) return { success: false as const, error: "not found" };
  await db.payment.create({ … });
  revalidatePath(`/invoices/${id}`);
}
```

Accept an **ID plus the change**, never a whole object: a well-formed `Invoice` can still name a row
the caller doesn't own. Rendering the form only on an authenticated page is **not** a security
boundary — the action is reachable by direct POST.

*DevDigest:* none of this exists in `client/`, and shouldn't — authority lives in the Fastify
package. This example is for projects where Next *is* the backend.

---

## 16. Push request-scoped reads downward

```tsx
// ❌ awaiting at the top makes the whole subtree dynamic
export default async function Layout({ children }) {
  const cookieStore = await cookies();
  return <Shell theme={cookieStore.get("theme")?.value}>{children}</Shell>;
}

// ✅ pass the promise down; resolve it where it's used, inside Suspense
export default function Layout({ children }) {
  const theme = cookies().then((c) => c.get("theme")?.value);
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <Shell themePromise={theme}>{children}</Shell>
    </Suspense>
  );
}
```

Cookie *reads* work anywhere on the server; *writes* only in a Server Function or Route Handler —
"HTTP does not allow setting cookies after streaming starts." That is the architectural reason
mutations cannot live in render.

---

## 17. Don't build an API tier for your own Server Components

```ts
// ❌ prerendering fails at build (no server is listening) and costs a round trip at runtime
const res = await fetch("http://localhost:3000/api/invoices");

// ✅ call the data layer directly
const invoices = await getInvoices();
```

Route Handlers are for genuinely public HTTP surface — webhooks, OAuth callbacks, `rss.xml`, CORS,
mobile clients. Server Actions mutate, and are **queued**, so they are not a fetch layer either.

*DevDigest:* the repo already follows the spirit — the client calls the Fastify API on :3001 rather
than a Next API tier in front of it.
