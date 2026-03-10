# Splittify

An expense-splitting app built with Astro (SSR), HTMX, Alpine.js, and Supabase.

## Stack

- **Astro** (SSR mode with Node adapter)
- **HTMX** for partial page updates without full reloads
- **Alpine.js** for modal open/close and small reactive UI
- **Supabase** for authentication and PostgreSQL database

## Setup

### 1. Create a Supabase project

Go to [supabase.com](https://supabase.com), create a new project, and note your project URL and API keys.

### 2. Run the database schema

In the Supabase dashboard, open the SQL editor and run the contents of `supabase/schema.sql`. This creates all tables and RLS policies.

### 3. Configure environment variables

Copy `.env.example` to `.env` and fill in your values:

```
PUBLIC_SUPABASE_URL=https://your-project.supabase.co
PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Find these in your Supabase project under **Settings > API**.

### 4. Install dependencies

```bash
npm install
```

### 5. Run the development server

```bash
npm run dev
```

The app will be available at `http://localhost:4321`.

## Building for production

```bash
npm run build
npm run preview
```

The Node standalone adapter outputs to `dist/server/entry.mjs`. Run it with:

```bash
node dist/server/entry.mjs
```

## Features

- Sign up / sign in / sign out
- Create expense groups
- Invite members to groups by email (they must have an account first)
- Add expenses with custom payer and split selection
- Even cent-level splits (remainder distributed to first N members)
- Live balance calculations per group and per member
- Archive / unarchive groups
- Dashboard showing all groups with your net balance in each
