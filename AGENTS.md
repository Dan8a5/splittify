# AGENTS.md — Context for AI Agents

Read this before making any changes to the Splittify codebase.

---

## What This App Does

Splittify is a group expense-splitting app. Users create groups, invite members by email, add expenses, and see a running balance of who owes whom. Think Splitwise, minimal.

---

## Tech Stack

- **Astro v5** — full-stack SSR framework. All pages and API routes live in `src/pages/`.
- **Supabase** — Postgres database + Auth. Schema is in `supabase/schema.sql`.
- **HTMX v2** — handles form submissions that update portions of the page without a full reload.
- **Alpine.js v3** — handles modal open/close state only.
- **Vanilla CSS** — single file at `src/styles/global.css`. Dark theme, CSS variables.
- **Node.js adapter** — Astro runs in standalone SSR mode.

---

## Folder Structure

```
src/
├── pages/
│   ├── index.astro            # Public landing page
│   ├── signin.astro           # Sign in
│   ├── signup.astro           # Sign up
│   ├── dashboard.astro        # Authenticated home — lists groups
│   ├── groups/[id].astro      # Group detail — expenses, members, balances
│   └── api/
│       ├── auth/{signup,signin,signout}.ts
│       ├── groups/index.ts                     # Create group
│       ├── groups/[id]/expenses.ts             # Add expense (HTMX)
│       ├── groups/[id]/invite.ts               # Invite member (HTMX)
│       ├── groups/[id]/archive.ts              # Archive group
│       ├── groups/[id]/delete.ts               # Delete group
│       └── expenses/[expenseId]/delete.ts      # Delete expense
├── layouts/Layout.astro       # Page shell with nav, footer, CDN scripts
├── lib/
│   ├── supabase.ts            # Two Supabase client factories
│   └── balance.ts             # Balance and split calculation logic
├── styles/global.css          # All CSS
└── middleware.ts              # Protects /dashboard and /groups/* routes
```

---

## Key Patterns — Follow These

### API Routes Return HTML, Not JSON
HTMX routes (`expenses.ts`, `invite.ts`) return raw HTML strings. The response replaces a DOM element. Do not introduce JSON responses or client-side rendering for these routes.

### Two Supabase Clients — Use the Right One

```typescript
import { createSupabaseServerClient, createSupabaseAdmin } from '../../../../lib/supabase'

// For reading the current user's identity:
const supabase = createSupabaseServerClient(request, cookies)
const { data: { user } } = await supabase.auth.getUser()

// For all DB reads and writes (mutations):
const admin = createSupabaseAdmin()
```

- `createSupabaseServerClient` — reads the auth cookie; use it only to identify the user.
- `createSupabaseAdmin` — service role key; bypasses RLS; use for all DB queries on API routes.
- Never use the server client for DB queries. Always use the admin client after you've verified the user's identity manually.

### Every Mutation Must Check Membership
Before any group operation, verify the requesting user is a member:

```typescript
const { data: membership } = await admin
  .from('group_members')
  .select('id')
  .eq('group_id', groupId)
  .eq('user_id', user.id)
  .single()

if (!membership) return new Response('Forbidden', { status: 403 })
```

Do not rely on RLS alone for authorization in API routes.

### Money is Always Cents
All amounts are stored and passed around as integer cents. Never use floats for money. Use `centsToDisplay(cents)` from `src/lib/balance.ts` to format for display.

### Standard API Route Structure
```typescript
export const POST: APIRoute = async ({ request, cookies, params }) => {
  // 1. Get user
  const supabase = createSupabaseServerClient(request, cookies)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const admin = createSupabaseAdmin()

  // 2. Check membership (if group-scoped)
  // ...

  // 3. Do the thing
  // ...

  // 4. Return redirect or HTML snippet
}
```

---

## Key Files to Know

| File | What It Does |
|------|--------------|
| `src/lib/supabase.ts` | Exports `createSupabaseServerClient` and `createSupabaseAdmin` |
| `src/lib/balance.ts` | `calculateBalances()`, `calculateSplits()`, `centsToDisplay()` |
| `src/middleware.ts` | Redirects unauthenticated users away from `/dashboard` and `/groups/*` |
| `src/layouts/Layout.astro` | The page shell — HTMX and Alpine.js are loaded here via CDN |
| `supabase/schema.sql` | Full DB schema, RLS policies, triggers, helper functions |
| `src/styles/global.css` | All CSS — CSS variables defined at `:root` |

---

## Database Tables (Quick Reference)

| Table | Key Columns |
|-------|-------------|
| `profiles` | `id` (= auth.users.id), `email` |
| `groups` | `id`, `name`, `created_by`, `archived` |
| `group_members` | `group_id`, `user_id` — unique pair |
| `expenses` | `id`, `group_id`, `paid_by`, `amount_cents`, `description` |
| `expense_splits` | `expense_id`, `user_id`, `amount_cents` |

---

## What to Avoid

- **Do not add client-side JavaScript** beyond HTMX and Alpine.js. No React, Vue, or custom JS files.
- **Do not add JSON API routes.** All responses are HTML (or redirects).
- **Do not use floating-point for money.** Always use integer cents.
- **Do not skip membership checks** in API routes, even if RLS would theoretically block it.
- **Do not call `createSupabaseAdmin()` on the client side.** It is server-only.
- **Do not add a new CSS file.** Add styles to `src/styles/global.css`.
- **Do not add a new layout.** All pages use `src/layouts/Layout.astro`.
- **Do not store computed values** (balances, totals) in the database. Calculate them at render time from `expenses` and `expense_splits`.
- **Do not introduce a package manager other than npm.**

---

## HTMX Conventions

- **Targets** are identified by `id` attributes (e.g., `#expenses-section`, `#members-list`).
- **Out-of-band swaps** use `hx-swap-oob="innerHTML:#target-id"` wrapping extra HTML in the response. See `expenses.ts` for an example.
- **Form reset** on success: `hx-on::after-request="if(event.detail.successful) this.reset()"`.

---

## Alpine.js Conventions

Alpine.js is used only for modal state. Pattern:

```html
<div x-data="{ open: false }">
  <button @click="open = true">Open</button>
  <div x-show="open" x-cloak class="modal-backdrop" @click.self="open = false">
    ...
  </div>
</div>
```

Do not use Alpine.js for data fetching, API calls, or anything HTMX already handles.

---

## Styling Conventions

CSS variables (defined in `:root` in `global.css`):
- Colors: `--green`, `--yellow`, `--blue`, `--red`, `--text`, `--text-muted`, `--bg`, `--surface`, `--border`
- Reusable classes: `.btn`, `.btn-outline-green`, `.btn-outline-yellow`, `.btn-ghost`, `.btn-red`, `.card`, `.card-link`, `.modal`, `.modal-backdrop`, `.form-group`

Add new component styles to `global.css`. Use existing variables. Do not use inline styles for anything that will recur.

---

## Environment Variables

```
PUBLIC_SUPABASE_URL         # Available on client and server
PUBLIC_SUPABASE_ANON_KEY    # Available on client and server
SUPABASE_SERVICE_ROLE_KEY   # Server only — never expose to browser
```

Accessed via `import.meta.env.VARIABLE_NAME` in Astro files.
