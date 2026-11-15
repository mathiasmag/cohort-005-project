# Coding standards

## Fail with a thrown response, not a return value

A loader or an action that cannot continue throws. It does not return an
error shape for the component to unpack.

```ts
if (!course) throw data("Course not found", { status: 404 });
```

The route then has one success path. A returned error shape gives every
component a second path to forget about.

## A comment and its code agree

A comment states what the code next to it does. When they disagree, the
spec decides which one is wrong: "capped at 2,000" above `.max(5000)` is a
bug in the code if the spec says 2,000. Fix the side the spec contradicts.

## Parse untrusted input with a schema

Form data, search parameters and request bodies get a zod schema before the
values reach any query.

ESLint (`npm run lint`) enforces the mechanical rules: no `any`, no `!`, and
no `.get(...) as` casts. Existing violations sit in `eslint-suppressions.json`.
Fixing one means removing its entry; new code adds none.

## Every action intent checks access itself

Each intent in an action re-checks access with the same helper the
neighbouring intents use (`requireContentAccess` for Lesson content), then
404s any id from the form that does not belong to the resource in the URL.
Being signed in is not access. Loader guards do not protect actions.

## Domain logic lives in a service module

Rules about a domain concept go in `app/lib/<concept>.server.ts` as
functions that take `db` as their first argument, tested with
`createTestDb()` in a sibling `.server.test.ts` (see
`app/lib/comments.server.ts`). A route file parses input, checks access,
calls the service, and renders.
