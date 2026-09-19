# Flaky test examples

## Sleep instead of awaiting

```ts
// flaky
startSync();
await new Promise((r) => setTimeout(r, 200));
expect(store.synced).toBe(true);

// deterministic
await startSync();
expect(store.synced).toBe(true);
```

## Real clock

```ts
// flaky: fails on the last day of the month
expect(nextBillingDate()).toEqual(new Date(2026, new Date().getMonth() + 1, 1));

// deterministic
vi.setSystemTime(new Date('2026-01-31T12:00:00Z'));
expect(nextBillingDate()).toEqual(new Date('2026-02-01T00:00:00Z'));
```

## Order dependence

```ts
// flaky: depends on the previous test having created the user
it('lists users', async () => {
  expect(await listUsers()).toHaveLength(1);
});

// deterministic
it('lists users', async () => {
  await createUser({ email: `u-${randomUUID()}@test` });
  expect(await listUsers()).toContainEqual(expect.objectContaining({ email: expect.any(String) }));
});
```

## Unordered rows

```ts
// flaky: no ORDER BY
expect(await repo.list()).toEqual([a, b]);

// deterministic
expect(await repo.list()).toEqual(expect.arrayContaining([a, b]));
```
