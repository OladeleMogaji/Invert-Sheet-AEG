# Shared database setup (Supabase)

One-time setup so every sheet and photo goes to one place the office can see.
Takes about 15 minutes. You only need the Supabase dashboard (supabase.com).

## 1. Create the project
- supabase.com → New project → name `aeg-invert-sheet`, region **East US (Ohio)**, plan **Free**.
- Generate and save the database password (not needed day to day).

## 2. Run the setup script
- Left menu → **SQL Editor** → **New query**.
- Paste the whole of `supabase-setup.sql` (in this folder) and click **Run**.
- You should see "Success. No rows returned". It's safe to run again.

## 3. Only let people you add sign in
- **Authentication → Sign In / Providers** (or **Authentication → Settings**).
- Turn **off** "Allow new users to sign up".
- Under **Email**, turn **off** "Confirm email" (you create accounts yourself, so no confirmation emails are needed).

## 4. Add your team
For each person: **Authentication → Users → Add user → Create new user**
- Email: their work email
- Password: a temporary password you give them
- Tick **Auto Confirm User**

Each person gets a profile automatically with the role **crew**.

## 5. Set names and roles
**Table Editor → profiles**
- `full_name`: how their name should appear on sheets (e.g. "Sam Okafor")
- `role`: `crew`, `supervisor` (can do QA/QC sign-off) or `admin`

## 6. Connect the app
**Project Settings → API**, copy:
- **Project URL** (`https://xxxx.supabase.co`)
- **anon public** key (or the **publishable** key)

Put them in `config.js` (or send them to whoever maintains the app). Never put the
**service_role / secret** key in the app.

## Day to day
- People sign in once per device; the app remembers them.
- Sheets upload in the background whenever there's signal. The top bar shows
  "All synced", "N waiting to upload", or "Offline".
- Remove someone: Authentication → Users → delete the user.
- Reset a password: Authentication → Users → … → Send password recovery, or delete and re-add.

## Free plan limits
- 1 GB of photo storage (roughly 300–500 structures with 2–3 photos each).
- 500 MB database (tens of thousands of sheets).
- A free project **pauses after 7 days with no activity**. Open the dashboard and click
  **Restore** to wake it. Daily use keeps it awake.
- Upgrade to Pro ($25/month, 100 GB) when photo storage gets close to 1 GB:
  Project Settings → Billing.
