# Altron backend (Supabase)

The desk runs on a simulated market and keeps its paper book in the browser until this is connected. `schema.sql` holds everything the live version needs: the one trading account, orders, fills, trades, the trade notes members read, and the notices members are sent (entries, working orders, fills, moved stops and targets, exits), which can't be edited or deleted once sent.

## Set up

1. Create a project at supabase.com. Any region near New York is fine.
2. Open **SQL Editor**, paste all of `schema.sql`, and run it. It is safe to run again later.
3. In **Authentication → Providers**, keep Email on (magic links work well for members).
4. Sign in to the site once as Yazan, then make that account the trader. In the SQL Editor:

   ```sql
   update public.profiles set role = 'trader'
   where id = (select id from auth.users where email = 'YAZAN_EMAIL_HERE');
   ```

5. Add two environment variables in Vercel (**Settings → Environment Variables**, all environments), from Supabase **Project Settings → API**:

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
