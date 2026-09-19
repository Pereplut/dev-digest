# shared — `@devdigest/shared`

Zod schemas + inferred types used across packages. Export map: header of [index.ts](index.ts).

## Who consumes this copy
- `server/` → alias `./src/vendor/shared`
- `reviewer-core/` → alias `../server/src/vendor/shared`
- `client/` → **its own copy** at `client/src/vendor/shared` (already drifted from this one)

## Rules
- This directory is canonical. A contract change here is a **cross-package change**:
  run typecheck + tests in `server/` and `reviewer-core/`.
- If the client uses the changed contract, mirror the change into `client/src/vendor/shared` and run `pnpm typecheck` there.
- The barrel is stable: add new files under `contracts/` and export them; don't rename or remove existing exports.
- Server routes use these schemas directly — changing a shape changes request validation and response serialization.
- Schemas only: no runtime logic, no imports from server/client code.
