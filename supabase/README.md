# Altron backend (Supabase)

The desk runs on a simulated market and keeps its paper book in the browser until this is connected. `schema.sql` holds everything the live version needs: the one trading account, orders, fills, trades, the trade notes members read, and the notices members are sent (entries, working orders, fills, moved stops and targets, exits), which can't be edited or deleted once sent.

## Set up

1. Create a project at supabase.com. Any region near New York is fine.
2. Open **SQL Editor**, paste all of `schema.sql`, and run it. It is safe to run again later.
3. In **Authentication → Providers**: keep **Email** on with "Confirm email" on, and turn on **Google** with a client ID and secret from Google Cloud (OAuth client of type Web application; authorized redirect URI `https://<project>.supabase.co/auth/v1/callback`).
4. In **Authentication → URL Configuration**, set the Site URL to `https://altron.capital` and add these redirect URLs: `https://altron.capital/**`, `https://www.altron.capital/**` and `https://*-luvfromsal.vercel.app/**` (previews).
5. Altron is invite only. An account can only be created, with Google or a password, for an email in `public.invites`, and it starts with the invite's role. The owner invites people, changes roles and removes or restores access on the **Admin** page (`/owner/admin`). The first owner is invited from the SQL Editor:

   ```sql
   insert into public.invites (email, role) values ('OWNER_EMAIL_HERE', 'owner')
   on conflict (email) do update set role = excluded.role;
   ```

   Who opens what: `/owner` (Dashboard, Follow, Admin) only the owner; `/trader` (Yazan's dashboard and desk) the trader and the owner; `/community` anyone with access. Removing access keeps the account and everything it wrote (trades, notes), so it can be given back.

6. Add two environment variables in Vercel (**Settings → Environment Variables**, all environments), from Supabase **Project Settings → API**:

   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

   The anon key is meant to be public. Row level security decides what each person can read and write. Never put the `service_role` key in the site.

## Who can do what

| | Trader | Members |
| --- | --- | --- |
| Trades and fills | write | read, live |
| Notes | write, edit | read, live |
| Note history | written automatically on every edit | read |
| Working orders | write | no access |
| Desk settings | write | no access |

- A note's send time never changes. Editing keeps the replaced text with the time it was replaced, which is what members see as "edited".
- Notes cannot be deleted, so the record members saw stays intact.
- Roles can only be changed from the SQL Editor. Nobody can promote themselves from the site.

## Live updates

Trades, fills, notes, note history and notices are added to Supabase Realtime, so members' screens update as Yazan trades and writes.
