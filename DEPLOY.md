# Deploying

Two options below. **Render** is the current path — no card, no server to
manage, free HTTPS subdomain out of the box, deploys on every push. AWS EC2
is kept for later if this outgrows Render's free tier.

## Render (current)

1. Push this repo to GitHub if it isn't already.
2. [render.com](https://render.com) → sign up with GitHub (no card needed).
3. New → Blueprint → connect the repo. Render reads `render.yaml` and creates the web service automatically (region: Frankfurt — closest free-tier region to Nigeria).
4. Before the first deploy finishes, open the service's **Environment** tab and set the real values for every `sync: false` var in `render.yaml`:
   - `APP_BASE_URL` → `https://tinypay.onrender.com` (or whatever Render assigns — shown at the top of the service page)
   - `DATABASE_URL` / `DIRECT_URL` → your Supabase connection strings
   - `PAYSTACK_SECRET_KEY` / `PAYSTACK_PUBLIC_KEY`
   - `BIGISUB_API_TOKEN` / `BIGISUB_TRANSACTION_PIN`
   - `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET`
5. Save → Render redeploys with the real env vars. The app registers the Telegram webhook against `APP_BASE_URL` automatically on boot; set Paystack's webhook URL (`https://.../webhooks/paystack`) once in the Paystack dashboard.
6. Check `GET https://tinypay.onrender.com/health` — should report `{"status":"ok", "db":"up", "telegram":"up"}`.

Redeploying after this: just `git push` — Render rebuilds and redeploys automatically on every push to the connected branch. No SSH, no `deploy.sh` needed (that script is for the AWS path below).

**The one real tradeoff**: the free tier sleeps after 15 minutes with no traffic and takes ~30-60s to wake on the next request. Fine for low traffic; the first message after a quiet spell will feel slow, and Paystack retries a webhook that times out during wake-up, so funding isn't lost — just delayed.

## AWS EC2 (later, if needed)

Keep this for if/when the sleep behavior or free-tier limits actually become a problem — a real always-on VM, more setup, needs its own domain for HTTPS.

Telegram and Paystack webhooks both need HTTPS on a real domain — Let's
Encrypt (certbot) won't issue a certificate for a bare IP, so you need a
domain pointed at the instance before step 5.

### 1. AWS account + billing alarm

1. Create an AWS account at [aws.amazon.com](https://aws.amazon.com) (requires a card — won't be charged while within free-tier limits). This is a separate signup from a regular Amazon.com shopping account, even under the same email.
2. **Billing alarm, before anything else**: Billing Console → Billing Preferences → enable "Receive Billing Alerts", then CloudWatch → Alarms → create one on `EstimatedCharges` for, say, $1.

### 2. Launch the instance

EC2 Console → Launch Instance:
- AMI: **Ubuntu Server 24.04 LTS**
- Instance type: **t2.micro** (or t3.micro — both free-tier eligible; availability varies by region)
- Key pair: create one, download the `.pem` — the only way to SSH in
- Security group — inbound rules: SSH (22) from your IP only, HTTP (80) and HTTPS (443) from anywhere
- Storage: default 8GB gp3 is fine (free tier covers up to 30GB)

Note the instance's public IPv4 address, and point your domain's A record at it.

### 3. Connect and bootstrap the server

```bash
chmod 400 your-key.pem
ssh -i your-key.pem ubuntu@YOUR_INSTANCE_IP
```

On the server:

```bash
sudo apt update && sudo apt upgrade -y

# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# pnpm + pm2
sudo npm install -g pnpm pm2
pm2 startup systemd   # follow the printed sudo command, then run it

# nginx + certbot
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 4. Get the app onto the server

```bash
git clone <your-repo-url> ~/tinypay
cd ~/tinypay
cp .env.example .env
nano .env   # fill in real DATABASE_URL/DIRECT_URL, PAYSTACK_*, BIGISUB_*, TELEGRAM_*
```

`APP_BASE_URL` must be `https://YOUR_DOMAIN`.

### 5. nginx + HTTPS

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/tinypay
sudo sed -i "s/YOUR_DOMAIN/your.actual.domain/" /etc/nginx/sites-available/tinypay
sudo ln -s /etc/nginx/sites-available/tinypay /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d your.actual.domain
```

### 6. First deploy

```bash
cd ~/tinypay
pnpm install --frozen-lockfile
pnpm exec prisma migrate deploy
pnpm run build
pm2 start deploy/ecosystem.config.cjs
pm2 save
```

Check `GET https://your.actual.domain/health`.

### Redeploying

```bash
ssh -i your-key.pem ubuntu@YOUR_INSTANCE_IP
cd ~/tinypay && ./deploy/deploy.sh
```

- `pm2 startup` + `pm2 save` means the app survives a reboot.
- Logs: `pm2 logs tinypay`.
- `.env` is never committed (gitignored) — it only ever exists on the server, edited directly via SSH.
