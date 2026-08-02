# Instagram Feed — One-Time Setup (Gary, ~15 minutes)

The site refreshes @kcwatchtrading's latest 9 posts every 6 hours automatically.
Until this setup is done, the homepage shows the design-review tiles.

## Step 1 — Business Manager: give the system user Instagram access
1. business.facebook.com → Settings → Users → System Users → **kcwtalerts**
2. "Assign Assets" → Instagram Accounts → select **@kcwatchtrading** → grant read access (Content permission).

## Step 2 — Add permission + generate token
1. Same system user → "Generate New Token"
2. App: **KCWT Alerts** (ID 871515428973917)
3. Check scopes: **instagram_basic**, **pages_show_list**, **business_management**
4. Token expiration: **Never**
5. Copy the token. (Treat like a password — send it to me in this chat only if you want me to verify it, then rotate later, or paste it straight into GitHub yourself in Step 4.)

## Step 3 — Get the IG User ID (one-time, I can do this for you)
With the token, this URL returns it:
`https://graph.facebook.com/v21.0/me/accounts?fields=instagram_business_account{id,username}&access_token=TOKEN`
The number under `instagram_business_account.id` is the IG_USER_ID.

## Step 4 — GitHub Secrets (2 fields)
github.com/gblanchard77-beep/kcwatchtrading → Settings → Secrets and variables → Actions → New repository secret:
- Name: `IG_ACCESS_TOKEN` → paste token
- Name: `IG_USER_ID` → paste the ID from Step 3

## Step 5 — First run
Repo → Actions tab → "Instagram feed refresh" → Run workflow.
Green check = live posts on the site in ~2 minutes. After that it runs itself every 6 hours forever.

## Failure behavior (already built in)
If Instagram/Meta errors or the token is ever revoked, the job exits WITHOUT committing —
the site keeps showing the last successful feed indefinitely. Nothing ever looks broken.
