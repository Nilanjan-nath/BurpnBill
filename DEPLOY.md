# Deploying BurpnBill

One Lightsail VM runs Caddy (web app + TLS) and the Node API. Cloudflare sits in front.
Steps marked **(you)** are in a dashboard; the rest are shell commands on the VM.
Nothing here needs a secret in git: the `.env` files are created on the VM.

## 1. AWS Lightsail: VM (you)

1. Lightsail > Create instance: region **Mumbai (ap-south-1)**, Linux, OS only, **Ubuntu 24.04 LTS**, 1 GB plan or larger (the web build needs the memory).
2. Networking tab: attach a **static IP** (13.234.200.141), and add firewall rules **HTTP (80)** and **HTTPS (443)** from any IPv4 address. SSH (22) is already open.
3. Connect with the orange "Connect using SSH" button, or download the key and use `ssh -i <key> ubuntu@13.234.200.141`.

## 2. Cloudflare and Namecheap (you)

1. cloudflare.com: add the site `burpnbill.com` on the Free plan. Cloudflare shows two nameservers.
2. Namecheap > Domain List > Manage > Nameservers > Custom DNS: paste those two. Propagation takes minutes to hours; Cloudflare emails when active.
3. Cloudflare > DNS > add two **A** records to the VM's IP (13.234.200.141): `www` and `@`. Set both to **DNS only (grey cloud)** for now, so Caddy can get its certificate. You turn the orange cloud on in step 8.
4. Cloudflare > SSL/TLS: set the mode to **Full (strict)**.

## 3. Supabase (you)

Authentication > URL Configuration: Site URL `https://www.burpnbill.com`, and add it under Redirect URLs. Confirm "Confirm email" is on.

## 4. Prepare the VM

```bash
ssh -i <your-key> ubuntu@13.234.200.141
```

Ubuntu on Lightsail has no firewall of its own; the Lightsail Networking rules from step 1 are the only ones.

On a 1 GB plan, add swap first, or the web build can run out of memory:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Install Node 22, Caddy and git:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
node -v   # v22.x
```

## 5. Get the code

```bash
sudo useradd --system --create-home --shell /bin/bash burpnbill
sudo mkdir -p /opt/burpnbill && sudo chown burpnbill:burpnbill /opt/burpnbill
sudo -u burpnbill git clone <REPO_URL> /opt/burpnbill
```

If the repo is private, add a read-only deploy key for the `burpnbill` user first (GitHub > repo > Settings > Deploy keys).

## 6. Configure

```bash
sudo -u burpnbill cp /opt/burpnbill/.env.production.example /opt/burpnbill/.env
sudo -u burpnbill nano /opt/burpnbill/.env          # fill in real values
sudo chmod 600 /opt/burpnbill/.env
sudo -u burpnbill nano /opt/burpnbill/web/.env      # VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY only
```

Let the deploy script restart the service without a password:

```bash
echo 'burpnbill ALL=(root) NOPASSWD: /usr/bin/systemctl restart burpnbill-api' | sudo tee /etc/sudoers.d/burpnbill
sudo chmod 440 /etc/sudoers.d/burpnbill
```

## 7. First build and start

```bash
sudo -u burpnbill bash -c 'cd /opt/burpnbill && npm ci --prefix server --omit=dev && npm ci --prefix web && npm run build --prefix web'
sudo cp /opt/burpnbill/deploy/burpnbill-api.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now burpnbill-api
curl -s localhost:4000/health/ready    # expect {"status":"ok",...}

sudo mkdir -p /var/log/caddy && sudo chown caddy:caddy /var/log/caddy
sudo cp /opt/burpnbill/deploy/Caddyfile /etc/caddy/Caddyfile
sudo chmod -R o+rX /opt/burpnbill/web/dist
sudo systemctl reload caddy
curl -sI https://www.burpnbill.com | head -3    # 200, valid certificate
```

If Caddy cannot read `web/dist`, check that `/opt` and `/opt/burpnbill` are world-traversable (`chmod o+x`).

## 8. Turn Cloudflare on (you)

Once `https://www.burpnbill.com` works with the grey cloud, flip both A records to **Proxied (orange cloud)** in Cloudflare. Reload the site. The kitchen board's live stream keeps working (the API sends a heartbeat every 25 s, inside Cloudflare's 100 s idle limit). If the certificate is ever not renewing behind the proxy, set the records back to grey for a minute.

## 9. Check it

- Landing page loads over HTTPS; `burpnbill.com` redirects to `www`.
- `/staff` signs in; the board and menu show.
- Reload `/staff` and a `/t/<token>` page: no 404.
- Place one order from a phone on **mobile data** and watch it reach the board.
- Print a QR from the live dashboard and scan it: the URL starts `https://www.burpnbill.com/t/`.
- Do not make anyone sign up live: Supabase's built-in email sender allows only a few messages an hour.

## Later deploys

```bash
ssh ubuntu@13.234.200.141
sudo -u burpnbill /opt/burpnbill/deploy/deploy.sh
```

It pulls, builds, restarts, checks `/health/ready`, and rolls back to the previous commit and web build if the check fails. Logs: `journalctl -u burpnbill-api -f` and `/var/log/caddy/burpnbill.log`.
