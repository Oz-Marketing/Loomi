# Component testing

Cypress mounts **one React component at a time** in real Chrome, with no
server, no database and no sign-in. It sits between the two other layers:

| Layer | Command | Answers |
|---|---|---|
| Unit | `npm run test` (vitest, Node) | Does this function return the right thing? |
| **Component** | `npm run ct` | Does this component behave right when a person clicks, types and tabs through it? |
| End-to-end | `npm run e2e` ([runbook](e2e-testing.md)) | Does the app come up and let a person in? |

It runs in a real browser, not jsdom, so it can check the things jsdom has no
way to see: layout, computed styles, and animations actually finishing.
`collapse.cy.tsx` asserts real rendered heights, for example.

---

## Running it

```bash
npm run ct        # headless, retries failures twice
npm run ct:open   # interactive runner, no retries — use while writing a spec
```

No server needed. Cypress builds the specs with **Next's own webpack config**
(`framework: 'next'` in `cypress.config.ts`), so `@/` imports, `'use client'`
modules and Tailwind work the same as in the app. `globals.css` is loaded
for every spec (`cypress/support/component.tsx`), and the page is stamped
`data-theme="dark"` like the real root layout.

**Running from a VS Code terminal?** VS Code exports `ELECTRON_RUN_AS_NODE=1`,
which stops Cypress from starting ("bad option: --smoke-test", or a bare
`MODULE_NOT_FOUND`). Unset it for the run:

```bash
env -u ELECTRON_RUN_AS_NODE npm run ct
```

## Writing a spec

- Specs go in **`cypress/component/**/*.cy.tsx`**, mirroring the path under
  `src/components/`. **Never put them next to the component.** The root
  tsconfig includes every `*.tsx` outside `cypress/`, so a spec next to its
  component would be typechecked by `npm run verify` without Cypress's
  globals and would break the deploy gate.
- `npm run verify:e2e` typechecks them. `npm run verify` does not.
- Most Loomi inputs are **controlled** (`value` + `onChange`). Wrap them in a
  small stateful harness in the spec so clicks actually change something, and
  assert on the outcome. See `tag-input.cy.tsx`.
- Use `cy.spy()` for callbacks, and assert with `should` so the check
  retries instead of racing a re-render.
- Components that call `fetch`, `useSession`, `useRouter` or `useAccount` need
  those stubbed or provided before they mount. Start with the leaf components
  in `src/components/ui/`, which need none of that.

## CI

`.github/workflows/tests.yml` runs the suite on every PR and on pushes to
`main`, and posts to Slack when a `main` run fails. The alert lists the failed
tests (up to 10), the count, and the commit. It gets those from
`cypress/results/component-summary.json`, which `cypress.config.ts` writes after
every `cypress run`. A test that passes on a retry isn't listed. Like `e2e.yml`, it is
**not a deploy gate**. The only required check is still `verify`.
