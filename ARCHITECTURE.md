# Splittify — Architecture

Splittify is a group expense-splitting app. Users create groups (e.g. trips), add members, log expenses, and see who owes whom. This document explains every architectural decision and the reasoning behind it.

---

## Tech Stack

| Layer | Technology | Why |
|-------|------------|-----|
| Framework | Astro v5 (SSR) | Full-stack with built-in API routes, minimal client JS, excellent SSR primitives |
| Database & Auth | Supabase (Postgres + Auth) | Handles auth, RLS, and triggers out of the box; no need to build auth from scratch |
| Partial Updates | HTMX v2 | Lets forms update sections of the page without a full reload, no custom JS needed |
| Modal Interactivity | Alpine.js v3 | Lightweight reactive state for toggling modals; no full JS framework needed |
| CSS | Vanilla CSS (single global file) | The app is small enough that a framework adds more complexity than it removes |
| Runtime | Node.js (standalone) | Required by Astro's Node adapter for SSR |

---

## Rendering Strategy: Server-Side Rendering

Astro is configured in `output: 'server'` mode (`astro.config.mjs`). Every page is rendered on the server on each request.

**Why SSR instead of SSG:**
- Auth state must be checked per-request (can't pre-render a protected dashboard).
- Group data is user-specific and changes frequently.
- Simpler mental model: the server always has the latest data, no client-side fetch waterfalls.

---

## Folder Structure

```
src/
├── pages/
│   ├── index.astro            # Public landing page
│   ├── signin.astro           # Sign in form
│   ├── signup.astro           # Sign up form
│   ├── dashboard.astro        # Authenticated user home (groups list)
│   ├── groups/
│   │   └── [id].astro         # Group detail page (expenses + members + balances)
│   └── api/
│       ├── auth/
│       │   ├── signup.ts      # POST — registers user
│       │   ├── signin.ts      # POST — authenticates user
│       │   └── signout.ts     # POST — clears session
│       ├── groups/
│       │   ├── index.ts       # POST — creates group
│       │   └── [id]/
│       │       ├── expenses.ts # POST — adds expense, returns HTML (HTMX)
│       │       ├── invite.ts   # POST — invites member by email, returns HTML (HTMX)
│       │       ├── archive.ts  # POST — toggles archived state
│       │       └── delete.ts   # POST — deletes group
│       └── expenses/
│           └── [expenseId]/
│               └── delete.ts  # POST — deletes a single expense
├── layouts/
│   └── Layout.astro           # Shell: nav, footer, CDN scripts
├── lib/
│   ├── supabase.ts            # Supabase client factories
│   └── balance.ts             # Balance calculation utilities
├── styles/
│   └── global.css             # All CSS (dark theme, component classes)
├── middleware.ts              # Route protection
└── env.d.ts                   # TypeScript env declarations

supabase/
└── schema.sql                 # Full DB schema, RLS policies, triggers
```

---

## Authentication

Authentication is handled entirely by Supabase Auth. The app uses the `@supabase/ssr` package to manage sessions via HTTP cookies, which works correctly in SSR environments.

### Signup Flow
1. User submits email + password to `POST /api/auth/signup`.
2. Route calls `supabase.auth.signUp()` — Supabase creates the user in `auth.users`.
3. A database trigger fires and inserts a row into the `profiles` table.
4. The route also upserts the profile via the admin client as a safety net.
5. User is redirected to `/dashboard`.

### Session Management
- `createSupabaseServerClient(request, cookies)` — reads/writes the auth session cookie. Used to identify the current user.
- `createSupabaseAdmin()` — uses the service role key to bypass RLS for server-side validation logic (e.g., checking group membership before allowing mutations). **Never exposed to the client.**

---

## Middleware & Route Protection

`src/middleware.ts` intercepts every request. If the path starts with `/dashboard` or `/groups`, it calls `supabase.auth.getUser()`. If no valid session exists, it redirects to `/signin`. Authenticated users are attached to `context.locals` for use in pages.

---

## Database Schema

### Tables

**`profiles`** — mirrors `auth.users`; stores email for lookup
- Used to look up users by email during invites

**`groups`** — a group/trip
- `archived` boolean for soft-archiving

**`group_members`** — many-to-many join of users and groups
- Unique constraint on `(group_id, user_id)` prevents duplicates
- Source of truth for who has access to a group

**`expenses`** — a single expense paid by one member
- `amount_cents` stored as integer to avoid floating-point math

**`expense_splits`** — how an expense is divided across members
- Each row: one member's share of one expense

### Why Separate `expenses` and `expense_splits`?
Splitting the data into two tables keeps it normalized. Balances are never stored — they're computed on the fly from the raw splits. This means:
- No denormalization bugs (no cached balance going stale)
- Full audit trail of every split
- Easy to recalculate if the calculation logic changes

### Why Cents?
Storing amounts as integers (`amount_cents`) avoids floating-point rounding errors. `$10.50` is stored as `1050`. All display formatting happens at render time via `centsToDisplay()` in `src/lib/balance.ts`.

### Row Level Security (RLS)
RLS is enabled on all tables. The helper function `get_my_group_ids()` returns the groups the current user belongs to, and is used in RLS policies to gate reads/writes. The admin client bypasses RLS on the server — but only after the route explicitly performs its own membership check.

---

## Balance Calculation

`src/lib/balance.ts` contains two key functions:

**`calculateBalances(expenses, splits)`**
- For each expense: the payer's balance increases by the full amount.
- For each split: the split recipient's balance decreases by their share.
- Net result: positive = owed money, negative = owes money.

**`calculateSplits(amountCents, memberIds)`**
- Divides the amount equally across all members.
- Remainder cents (from integer division) are distributed one cent at a time to the first N members, ensuring the total always adds up exactly.

---

## HTMX Integration

HTMX is loaded via CDN in `Layout.astro`. It is used in two places:

1. **Add Expense form** — POSTs to `/api/groups/[id]/expenses`. The API returns an HTML snippet that replaces the expenses list and balances section using `hx-swap-oob`.
2. **Invite form** — POSTs to `/api/groups/[id]/invite`. The API returns an HTML snippet that replaces the members list.

**Design principle:** API routes that serve HTMX requests return HTML, not JSON. This keeps the rendering logic on the server and eliminates client-side template rendering.

---

## Client-Side Interactivity

| Tool | Used For |
|------|----------|
| HTMX | Form submissions with partial page updates |
| Alpine.js | Modal open/close state (`x-data`, `x-show`, `x-on`) |
| Vanilla JS | None beyond HTMX/Alpine |

There is no bundled JavaScript. No build step for client-side code. This keeps the app fast and simple.

---

## CSS Architecture

All styles live in `src/styles/global.css`. The app uses a fixed dark theme with CSS custom properties:

- `--bg`, `--surface`, `--border` — layout colors
- `--text`, `--text-muted` — typography
- `--green`, `--yellow`, `--blue`, `--red` — semantic colors

**Why no CSS framework?** The component surface area is small (one layout, five pages, a handful of reusable classes). A framework would add more concepts than it saves.

---

## API Design

All API routes follow the same pattern:

1. Verify user session (`supabase.auth.getUser()`).
2. If mutation affects a group, verify the user is a member.
3. Perform the operation using the admin client.
4. Return either a redirect (full page transitions) or an HTML snippet (HTMX partial updates).

There are no JSON APIs. The server always returns HTML.

---

## Environment Variables

| Variable | Scope | Purpose |
|----------|-------|---------|
| `PUBLIC_SUPABASE_URL` | Client + Server | Supabase project URL |
| `PUBLIC_SUPABASE_ANON_KEY` | Client + Server | Anon key for client-side auth |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Service role key for admin operations |

The service role key bypasses all RLS. It must never be sent to the browser. It is only used in `createSupabaseAdmin()` which is only called in `src/pages/api/` routes.
