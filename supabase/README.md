# Altron backend (Supabase)

The desk runs on a simulated market and keeps its paper book in the browser until this is connected. `schema.sql` holds everything the live version needs: the one trading account, orders, fills, trades, the trade notes members read, and the notices members are sent (entries, working orders, fills, moved stops and targets, exits), which can't be edited or deleted once sent.

## Set up

1. Create a project at supabase.com. Any region near New York is fine.
2. Open **SQL Editor**, paste all of `schema.sql`, and run it. It is safe to run again later.
3. In **Authentication → Providers**, keep Email on. The site signs people in with an emailed link; there are no passwords.
4. In **Authentication → URL Configuration**, set the Site URL to `https://altron.capital` and add these redirect URLs: `https://altron.capital/**`, `https://www.altron.capital/**` and `https://*-luvfromsal.vercel.app/**` (previews).
5. Altron is invite only: the sign-in form never creates accounts. Add each person under **Authentication → Users → Add user → Create new user** (tick Auto Confirm User; the password is never used). Every new account starts as a member. Then give the owner and the trader their roles in the SQL Editor:

   ```sql
   insert into public.profiles (id, role, display_name)
   select id, 'owner', 'Owner' from auth.users where email = 'OWNER_EMAIL_HERE'
   on conflict (id) do update set role = 'owner';

   insert into public.profiles (id, role, display_name)
   select id, 'trader', 'Yazan' from auth.users where email = 'YAZAN_EMAIL_HERE'
   on conflict (id) do update set role = 'trader';
   ```

   The owner's pages (`/owner`) open only for the owner. Yazan's pages and Community stay open until his account exists.

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
