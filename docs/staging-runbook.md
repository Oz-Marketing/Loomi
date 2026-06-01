# Staging environment runbook

How the `staging` environment is wired, and the one-time droplet setup needed to
bring it online. Staging mirrors production (same blue/green deploy, same
`/var/www/loomi-studio` layout) but runs on its **own DigitalOcean droplet** with
its **own database** and **its own (test) third-party credentials**.

```
feature/* ─PR→ staging ─(push → deploy-staging.yml → staging droplet)→ QA
                  └─PR→ main ─(push → deploy.yml → prod droplet)→ live
```

## How the GitHub side works (already set up)

| Piece | Value |
|---|---|
| Workflow | `.github/workflows/deploy-staging.yml` (triggers on push to `staging`) |
| Environment | `staging` — holds the staging-only secrets |
| Gate | repo Actions variable `STAGING_ENABLED` — deploy is **skipped** unless `true` |
| Branch protection | `staging` requires the `verify` check, 0 reviews |

The workflow is intentionally a near-copy of `deploy.yml`. Because staging is a
separate droplet, ports (3000/3001), process names, and paths are identical to
prod — only the **branch** (`staging`) and the **target host** (the `staging`
environment's `DO_HOST`) differ. Keep the script body in sync with `deploy.yml`.

---

## One-time droplet setup

### 1. Provision the droplet
**Fastest:** take a DigitalOcean **snapshot of the prod droplet**, then create a new
droplet *from that snapshot*. This inherits Node, PM2, nginx, the swap file, and
the `/var/www/loomi-studio` layout — you only have to repoint env/DB/domain below.
- Size: **2 GB / 1 vCPU ($12/mo)** recommended so `next build` doesn't lean on swap.
- Note the new droplet's public IP → this becomes `DO_HOST`.

**From scratch (if not snapshotting):** Ubuntu LTS, then install Node 20, `pm2`,
`nginx`, `postgresql`, `certbot`, and create the 2 GB swap file (the deploy script
also creates it if missing).

### 2. Create the staging database
On the droplet (local Postgres, separate from prod's data):
```bash
sudo -u postgres psql -c "CREATE DATABASE loomi_staging;"
sudo -u postgres psql -c "CREATE USER loomi_staging WITH PASSWORD '<STRONG_PW>';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE loomi_staging TO loomi_staging;"
```

### 3. Clone the repo + shared env
```bash
mkdir -p /var/www/loomi-studio && cd /var/www/loomi-studio
git clone https://github.com/Oz-Marketing/Loomi-Studio.git .
git checkout staging
mkdir -p shared
$EDITOR shared/.env.local
```
`shared/.env.local` must use **staging values** — most importantly:
- `DATABASE_URL=postgresql://loomi_staging:<STRONG_PW>@127.0.0.1:5432/loomi_staging?schema=public`
- A staging app URL (e.g. `NEXTAUTH_URL=https://staging.studio.loomilm.com`) + fresh auth secret
- **TEST / sandbox keys** for every third party (Meta, ESP/SMTP, Turnstile, …) — never prod keys, or staging will send real email and hit real ad APIs.

> ⚠️ Do **not** add a staging copy of `meta-pacer-alerts.yml`. That cron is prod-only;
> a second copy would double-fire alerts.

### 4. nginx + DNS + TLS
- Add a DNS **A record**: `staging.studio.loomilm.com → <droplet IP>`.
- nginx server block for `staging.studio.loomilm.com` that proxies to the upstream
  the deploy script manages:
  ```nginx
  upstream loomi_upstream { server 127.0.0.1:3000; keepalive 64; }  # /etc/nginx/conf.d/loomi-upstream.conf
  server {
    server_name staging.studio.loomilm.com;
    location / { proxy_pass http://loomi_upstream; proxy_set_header Host $host; }
  }
  ```
  (If you snapshotted prod, just change `server_name` to the staging host.)
- `sudo certbot --nginx -d staging.studio.loomilm.com` for TLS.

### 5. Give the GitHub Action SSH access
- Generate a keypair for CI (or reuse prod's), add the **public** key to the
  droplet's `root` `~/.ssh/authorized_keys`.
- In **GitHub → repo Settings → Environments → `staging`**, add secrets:
  - `DO_HOST` = staging droplet IP
  - `DO_SSH_KEY` = the **private** key

### 6. Flip the gate on
```bash
gh variable set STAGING_ENABLED -b true --repo Oz-Marketing/Loomi-Studio
```

### 7. First deploy
```bash
git push origin staging   # any commit on staging triggers deploy-staging.yml
```
Watch it under the repo's **Actions** tab, then load `https://staging.studio.loomilm.com`.

---

## Day-to-day
- Merge feature PRs into `staging` → auto-deploys to staging for QA.
- When happy, PR `staging → main` → auto-deploys to prod.

## Recommended follow-up (separate PR)
Switch the prod/staging build off `prisma db push --accept-data-loss` to versioned
`prisma migrate deploy`, tested on staging first. Staging only catches half the
risk while every deploy still force-pushes the schema.
