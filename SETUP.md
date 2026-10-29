# IPO Alerts: setup

Friends sign up on the public page, you check the day's IPOs on the admin page, and send either
**from your PC** (automatic, with names) or **from your phone** (paste into your WhatsApp broadcast list).

| Piece | Where it runs |
|---|---|
| `index.html` signup, `unsubscribe.html` | GitHub Pages |
| `admin.html` (only you) | GitHub Pages, works on phone and PC |
| Database | Supabase (free) |
| `sender/` (WhatsApp sending) | Your PC, only needed for "Send from PC" |

## 1. Supabase
1. Create a new project at supabase.com (free plan, region Mumbai).
2. SQL Editor → New query → paste `supabase/schema.sql` → Run. Then do the same with
   `supabase/002_unsubscribe_codes.sql` (WhatsApp-code unsubscribe + member count).
3. In another query, add yourself as admin:
   `insert into public.admins (email) values ('your-email@gmail.com');`
4. Authentication → URL Configuration: set **Site URL** to your Pages link
   (e.g. `https://sowki03.github.io/ipo-alerts/admin.html`) and add the same link under **Redirect URLs**.
   Add `http://localhost:5174/admin.html` too if you want to test locally.
5. Project Settings → API: copy the **Project URL** and **anon public** key into `js/config.js`.

## 2. GitHub Pages
1. Create a public repo `ipo-alerts` and push this folder.
2. Settings → Pages → Deploy from branch → `main` / root.
3. Share `https://<you>.github.io/ipo-alerts/`. Admin is at `/admin.html`.

## 3. PC sender
1. Copy `sender/.env.example` to `sender/.env` and fill in the Project URL and the
   **service_role** key (Project Settings → API). Never commit or share this key.
2. Double-click `sender/start-sender.bat`. The first run installs packages.
3. If it shows a QR, scan it: WhatsApp → Settings → Linked devices → Link a device.
   The admin page shows "PC sender: ready" once it's connected.

Keep the sender window open while you send from PC. Without it, use "Send from phone".
A PC send that waits more than 30 minutes (PC off) is skipped, so a stale message never goes out late.

## Daily use
1. Open the admin page → **Fetch today's IPOs**.
2. Check or edit the message.
3. **Send from PC** → "Send to all", or **Send from phone** → copy, paste into your broadcast list, send, then tap "I've sent it".
4. The "Broadcast list to-do" box lists new friends to add to (or stopped friends to remove from) your phone's broadcast list.
