#!/usr/bin/env bash
# SIRRADDO VPS helper: run extra Node backends (Zappi NG, TaskVerse) on the same server as ZAPPI PAY,
# each in its own folder, PM2 process and Nginx site. It never edits, restarts or removes anything
# that already exists (ZAPPI PAY, its Nginx site, tinyproxy).
#
#   bash vps-app.sh check                                   # memory, swap, what's running
#   bash vps-app.sh swap                                    # add a 1 GB swap file (only if there is none)
#   bash vps-app.sh add NAME PORT DOMAIN REPO [SUBFOLDER]   # first install of one backend
#   bash vps-app.sh env NAME                                # edit its settings (.env), then restart it
#   bash vps-app.sh https NAME                              # free HTTPS certificate once DNS points here
#   bash vps-app.sh update NAME                             # pull the latest code and restart
#   bash vps-app.sh logs NAME                               # last 60 log lines
#   bash vps-app.sh safety                                  # nightly backups, log clean-up, health monitor (once)
#   bash vps-app.sh status                                  # backups, monitor and disk at a glance
#   bash vps-app.sh backup                                  # back up the databases now
#   bash vps-app.sh restore DATABASE YYYY-MM-DD             # copy a backup into a NEW database (live data untouched)
#   bash vps-app.sh dbuser NAME                             # switch an app to its own database user (tested first)
#   bash vps-app.sh offsite                                 # also copy each night's backup to Cloudflare R2
#
# Run it as the same user you use for ZAPPI PAY's PM2 (if you log in as root, as root).
set -euo pipefail

APPS="${APPS_DIR:-/opt/apps}"
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mSTOP: %s\033[0m\n' "$*" >&2; exit 1; }
meta() { cat "$APPS/$1/.vps-app" 2>/dev/null || die "No app called $1 (try: bash vps-app.sh check)"; }

check() {
  say "Memory (MB)"; free -m
  say "Swap"; swapon --show || true
  say "Running apps (PM2)"; pm2 list 2>/dev/null || echo "pm2 not found for this user"
  local avail; avail=$(free -m | awk '/^Mem:/{print $7}')
  local swap; swap=$(free -m | awk '/^Swap:/{print $2}')
  echo
  echo "Available memory: ${avail} MB · swap: ${swap} MB"
  if [ "$avail" -lt 350 ] && [ "$swap" -lt 512 ]; then
    echo "→ Tight. Run 'bash vps-app.sh swap' before adding apps."
  else
    echo "→ OK to add one app at a time. Each is limited to 220 MB and restarts itself if it goes over."
  fi
}

swap() {
  if [ "$(free -m | awk '/^Swap:/{print $2}')" -gt 0 ]; then echo "Swap already exists, nothing to do."; return; fi
  say "Creating a 1 GB swap file"
  $SUDO fallocate -l 1G /swapfile && $SUDO chmod 600 /swapfile && $SUDO mkswap /swapfile && $SUDO swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null
  free -m
}

add() {
  local name="${1:-}" port="${2:-}" domain="${3:-}" repo="${4:-}" sub="${5:-}"
  [ -n "$name" ] && [ -n "$port" ] && [ -n "$domain" ] && [ -n "$repo" ] || die "Usage: bash vps-app.sh add NAME PORT DOMAIN REPO [SUBFOLDER]"
  [[ "$name" =~ ^[a-z0-9-]+$ ]] || die "NAME: lower-case letters, numbers and - only"
  [[ "$port" =~ ^[0-9]+$ ]] || die "PORT must be a number"
  [ -e "$APPS/$name" ] && die "$APPS/$name already exists. Use 'update $name' instead."
  if (ss -ltn 2>/dev/null || netstat -ltn) | grep -q ":$port "; then die "Port $port is already used by something else. Pick another (e.g. 4101, 4102)."; fi
  [ -e "/etc/nginx/sites-available/$name" ] && die "An Nginx site called $name already exists; not touching it."
  command -v node >/dev/null || die "Node is not installed for this user."
  command -v pm2 >/dev/null || die "PM2 is not installed for this user."

  say "Getting the code"
  $SUDO mkdir -p "$APPS" && $SUDO chown "$(id -u):$(id -g)" "$APPS"
  if ! GIT_TERMINAL_PROMPT=0 git clone --depth 1 "$repo" "$APPS/$name" 2>/dev/null; then
    local key="$HOME/.ssh/deploy_$name"
    mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
    [ -f "$key" ] || ssh-keygen -t ed25519 -N "" -f "$key" -C "vps-$name" >/dev/null
    grep -q "^Host github-$name\$" "$HOME/.ssh/config" 2>/dev/null || \
      printf 'Host github-%s\n  HostName github.com\n  User git\n  IdentityFile %s\n  IdentitiesOnly yes\n  StrictHostKeyChecking accept-new\n' "$name" "$key" >> "$HOME/.ssh/config"
    echo
    echo "This repo is private. Add this read-only key on GitHub:"
    echo "  repo → Settings → Deploy keys → Add deploy key (leave 'Allow write access' OFF)"
    echo
    cat "$key.pub"
    echo
    die "Then run the same 'add' command again, with REPO written as: git@github-$name:OWNER/REPO.git"
  fi
  printf 'PORT=%s\nDOMAIN=%s\nSUB=%s\n' "$port" "$domain" "$sub" > "$APPS/$name/.vps-app"
  local dir="$APPS/$name/$sub"
  say "Installing packages"
  (cd "$dir" && npm ci --omit=dev --no-audit --no-fund)

  say "Settings (.env)"
  if [ ! -f "$dir/.env" ]; then
    printf '# Paste the same settings this app has on Render (Environment tab).\n# Keep PORT as it is.\nPORT=%s\n' "$port" > "$dir/.env"
  fi
  chmod 600 "$dir/.env"
  echo "Now paste this app's settings from Render into the file that opens. Save with Ctrl+O, Enter, then Ctrl+X."
  read -r -p "Press Enter to open the editor… " _
  ${EDITOR:-nano} "$dir/.env"
  grep -q "^PORT=$port" "$dir/.env" || { sed -i '/^PORT=/d' "$dir/.env"; echo "PORT=$port" >> "$dir/.env"; }

  say "Starting $name with PM2 (220 MB limit)"
  (cd "$dir" && pm2 start npm --name "$name" --max-memory-restart 220M --time -- start)
  pm2 save
  sleep 4
  curl -fsS -m 5 "http://127.0.0.1:$port/health" >/dev/null 2>&1 && echo "Health check: OK" || echo "Health check didn't answer yet; see: bash vps-app.sh logs $name"

  say "Nginx site for $domain"
  $SUDO tee "/etc/nginx/sites-available/$name" >/dev/null <<NGINX
server {
  listen 80;
  server_name $domain;
  client_max_body_size 5m;
  location / {
    proxy_pass http://127.0.0.1:$port;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 60s;
  }
}
NGINX
  $SUDO ln -s "/etc/nginx/sites-available/$name" "/etc/nginx/sites-enabled/$name"
  if $SUDO nginx -t; then $SUDO systemctl reload nginx; else
    $SUDO rm -f "/etc/nginx/sites-enabled/$name"; die "Nginx test failed, so the new site was switched off again. Nothing else was changed."
  fi
  echo
  echo "Done. Next:"
  echo "  1. In Cloudflare DNS add: A  ${domain%%.*}  →  $(curl -fsS -m 5 https://api.ipify.org 2>/dev/null || echo 'this server IP')  (grey cloud, DNS only)"
  echo "  2. Then run: bash vps-app.sh https $name"
}

envedit() {
  local name="${1:-}"; [ -n "$name" ] || die "Usage: bash vps-app.sh env NAME"
  meta "$name" >/dev/null; . "$APPS/$name/.vps-app"
  ${EDITOR:-nano} "$APPS/$name/$SUB/.env"
  pm2 restart "$name" --update-env && pm2 save
}

https() {
  local name="${1:-}"; [ -n "$name" ] || die "Usage: bash vps-app.sh https NAME"
  meta "$name" >/dev/null; . "$APPS/$name/.vps-app"
  command -v certbot >/dev/null || { say "Installing certbot"; $SUDO apt-get update -qq && $SUDO apt-get install -y -qq certbot python3-certbot-nginx; }
  $SUDO certbot --nginx -d "$DOMAIN" --redirect --non-interactive --agree-tos --register-unsafely-without-email
  curl -fsS -m 8 "https://$DOMAIN/health" && echo && echo "HTTPS works: https://$DOMAIN"
}

update() {
  local name="${1:-}"; [ -n "$name" ] || die "Usage: bash vps-app.sh update NAME"
  meta "$name" >/dev/null; . "$APPS/$name/.vps-app"
  say "Updating $name"
  git -C "$APPS/$name" pull --ff-only
  (cd "$APPS/$name/$SUB" && npm ci --omit=dev --no-audit --no-fund)
  pm2 restart "$name" --update-env && pm2 save
  sleep 3; curl -fsS -m 5 "http://127.0.0.1:$PORT/health" >/dev/null && echo "Health check: OK" || echo "No answer yet; see: bash vps-app.sh logs $name"
}

logs() { local name="${1:-}"; [ -n "$name" ] || die "Usage: bash vps-app.sh logs NAME"; pm2 logs "$name" --lines 60 --nostream; }

OPS="$APPS/.ops"
RAW="https://raw.githubusercontent.com/sirraddo/taskverse-pi/main/ops"

safety() {
  local node pm2bin; node=$(command -v node) || die "Node not found"; pm2bin=$(command -v pm2) || die "PM2 not found"
  $SUDO mkdir -p "$OPS" && $SUDO chown "$(id -u):$(id -g)" "$OPS" && chmod 700 "$OPS"

  say "1/3 Database backups (every night at 03:30 Lagos time, last 7 kept)"
  local here; here="$(cd "$(dirname "$0")" && pwd)"
  if [ -f "$here/vps-backup.js" ]; then cp "$here/vps-backup.js" "$OPS/backup.js"; else curl -fsSL "$RAW/vps-backup.js" -o "$OPS/backup.js"; fi
  chmod 700 "$OPS/backup.js"

  say "2/3 Health monitor (every 5 minutes)"
  cat > "$OPS/monitor.sh" <<MON
#!/usr/bin/env bash
# Written by vps-app.sh safety. Checks each vps-app backend every 5 minutes; after 2 failed checks in a row it
# restarts that app. ZAPPI PAY is only checked and logged, never restarted.
export HOME="$HOME" PATH="$(dirname "$node"):\$PATH"
APPS="$APPS"; STATE="$OPS/.monitor"; mkdir -p "\$STATE"
ts() { date -u +%FT%TZ; }
for meta in "\$APPS"/*/.vps-app; do
  [ -f "\$meta" ] || continue
  name=\$(basename "\$(dirname "\$meta")"); port=\$(sed -n 's/^PORT=//p' "\$meta")
  if curl -fsS -m 10 "http://127.0.0.1:\$port/health" >/dev/null 2>&1; then
    [ -s "\$STATE/\$name" ] && echo "\$(ts) \$name back to normal"; : > "\$STATE/\$name"
  else
    n=\$(( \$(cat "\$STATE/\$name" 2>/dev/null || echo 0) + 1 )); echo \$n > "\$STATE/\$name"
    echo "\$(ts) \$name health check failed (\$n in a row)"
    if [ "\$n" -ge 2 ]; then "$pm2bin" restart "\$name" >/dev/null 2>&1 && echo "\$(ts) \$name restarted"; echo 0 > "\$STATE/\$name"; fi
  fi
done
curl -fsS -m 10 https://api.zappipay.com.ng/api/health >/dev/null 2>&1 || echo "\$(ts) zappi-pay health check failed (not restarted by this monitor)"
use=\$(df -P / | awk 'NR==2{gsub("%","",\$5); print \$5}')
[ "\$use" -ge 85 ] && echo "\$(ts) disk is \${use}% full"
exit 0
MON
  chmod 700 "$OPS/monitor.sh"

  say "3/3 Log clean-up (app logs kept 7 days, compressed)"
  $SUDO tee /etc/logrotate.d/vps-apps >/dev/null <<ROT
$HOME/.pm2/logs/*.log $OPS/*.log {
  daily
  rotate 7
  maxsize 20M
  compress
  delaycompress
  missingok
  notifempty
  copytruncate
}
ROT
  if command -v logrotate >/dev/null && ! $SUDO logrotate -d /etc/logrotate.d/vps-apps >/dev/null 2>&1; then $SUDO rm -f /etc/logrotate.d/vps-apps; die "Log clean-up settings were rejected and removed again; nothing else changed."; fi

  local tmp; tmp=$(mktemp)
  { crontab -l 2>/dev/null || true; } | { grep -v '# vps-app-safety' || true; } > "$tmp"
  echo "30 2 * * * cd $OPS && $node backup.js >> $OPS/backup.log 2>&1 # vps-app-safety" >> "$tmp"
  echo "*/5 * * * * $OPS/monitor.sh >> $OPS/monitor.log 2>&1 # vps-app-safety" >> "$tmp"
  crontab "$tmp" && rm -f "$tmp"

  say "First backup now"
  (cd "$OPS" && "$node" backup.js) || echo "The first backup had a problem; see the lines above."
  "$OPS/monitor.sh"
  echo
  echo "Done. See everything with: bash vps-app.sh status"
}

# Off-site copy of the nightly backups in a private Cloudflare R2 bucket (S3-compatible).
offsite() {
  [ -f "$OPS/backup.js" ] || die "Run 'bash vps-app.sh safety' first"
  local here; here="$(cd "$(dirname "$0")" && pwd)"
  if [ -f "$here/vps-backup.js" ]; then cp "$here/vps-backup.js" "$OPS/backup.js"; else curl -fsSL "$RAW/vps-backup.js" -o "$OPS/backup.js"; fi
  local acct ak sk bucket
  echo "From Cloudflare → R2 (see the steps Claude gave you):"
  read -r -p "Account ID: " acct
  read -r -p "Bucket name: " bucket
  read -r -p "Access Key ID: " ak
  read -r -s -p "Secret Access Key (typing is hidden): " sk; echo
  [ -n "$acct" ] && [ -n "$bucket" ] && [ -n "$ak" ] && [ -n "$sk" ] || die "All four are needed. Nothing changed."
  local f="$OPS/offsite.env" old="$OPS/offsite.env.old"
  [ -f "$f" ] && cp -p "$f" "$old"
  ( umask 077; printf 'R2_ACCOUNT_ID=%s\nR2_BUCKET=%s\nR2_ACCESS_KEY_ID=%s\nR2_SECRET_ACCESS_KEY=%s\nR2_KEEP_DAYS=14\n' "$acct" "$bucket" "$ak" "$sk" > "$f" )
  say "Testing upload, read and delete"
  if ! (cd "$OPS" && node backup.js offsite-test); then
    if [ -f "$old" ]; then mv "$old" "$f"; else rm -f "$f"; fi
    die "The test failed, so the settings were not kept. Check the four values and try again."
  fi
  rm -f "$old"
  local last; last=$(ls -1 "$APPS/.backups" 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' | sort | tail -1)
  if [ -n "$last" ]; then say "Uploading the latest backup ($last)"; (cd "$OPS" && node backup.js upload "$last") || echo "Upload had a problem; it will try again tonight."; fi
  echo "Done. From tonight each backup is also copied to R2 (last 14 days kept there)."
}

status() {
  say "Backups"; [ -f "$OPS/backup.js" ] && (cd "$OPS" && node backup.js list) || echo "Not set up yet: bash vps-app.sh safety"
  say "Monitor (last 10 events)"; tail -n 10 "$OPS/monitor.log" 2>/dev/null || echo "No events yet (no news is good news)."
  if [ -f "$OPS/offsite.env" ]; then say "Off-site copies (Cloudflare R2)"; (cd "$OPS" && node backup.js remote) || echo "Could not reach R2"; else say "Off-site copies"; echo "Not set up yet: bash vps-app.sh offsite"; fi
  say "Disk"; df -h / | tail -1
  say "Scheduled jobs"; crontab -l 2>/dev/null | grep 'vps-app-safety' || echo "None. Run: bash vps-app.sh safety"
}

backupnow() { [ -f "$OPS/backup.js" ] || die "Run 'bash vps-app.sh safety' first"; (cd "$OPS" && node backup.js); }
restoredb() { [ -f "$OPS/backup.js" ] || die "Run 'bash vps-app.sh safety' first"; (cd "$OPS" && node backup.js restore "$@"); }

# Switch one app to a different MongoDB user. Only the user name and password inside the app's connection
# string change (same cluster, same database, same options). The new login is tested first; .env is only
# changed if it works, and the old file is kept as .env.before-dbuser.
dbuser() {
  local name="${1:-}"; [ -n "$name" ] || die "Usage: bash vps-app.sh dbuser NAME"
  meta "$name" >/dev/null; . "$APPS/$name/.vps-app"
  local dir="$APPS/$name/$SUB" envf="$APPS/$name/$SUB/.env"
  [ -f "$envf" ] || die "No settings file for $name"
  local u p
  read -r -p "New database user name for $name: " u
  read -r -s -p "Its password (typing is hidden): " p; echo
  [ -n "$u" ] && [ -n "$p" ] || die "Both are needed. Nothing changed."
  say "Testing the new login (read and write) before changing anything"
  local out
  out=$(cd "$dir" && DBU="$u" DBP="$p" ENVF="$envf" node -e '
    const fs = require("fs");
    const env = fs.readFileSync(process.env.ENVF, "utf8");
    const m = env.match(/^(MONGODB_URI|MONGO_URI)=(.*)$/m);
    if (!m) { console.error("No MONGODB_URI or MONGO_URI in .env"); process.exit(2); }
    const key = m[1], old = m[2].trim().replace(/^(["\x27])(.*)\1$/, "$2");
    const u = new URL(old);
    u.username = encodeURIComponent(process.env.DBU); u.password = encodeURIComponent(process.env.DBP);
    const next = u.toString();
    const dbName = (env.match(/^MONGO_DB_NAME=(.*)$/m) || [])[1]?.trim() || decodeURIComponent(u.pathname.replace(/^\//, "")) || "test";
    const { MongoClient } = require(require.resolve("mongoose", { paths: [process.cwd()] })).mongo;
    (async () => {
      const c = new MongoClient(next, { serverSelectionTimeoutMS: 15000 });
      try {
        await c.connect();
        const db = c.db(dbName);
        const cols = await db.listCollections({}, { nameOnly: true }).toArray();
        const t = db.collection("_vps_app_check");
        await t.insertOne({ at: new Date() }); await t.drop();
        fs.writeFileSync(process.env.ENVF + ".new", env.replace(m[0], key + "=" + next), { mode: 0o600 });
        console.log("OK " + dbName + " " + cols.length);
      } catch (e) { console.error(e.codeName || e.message); process.exit(1); }
      finally { await c.close().catch(() => {}); }
    })();
  ' 2>&1) || die "The new login did not work ($out). Check the user name, password and that it has readWrite on this app's database. Nothing changed."
  set -- $out
  echo "Login works: it can read and write the \"$2\" database ($3 collections)."
  [ "$3" != "0" ] || { rm -f "$envf.new"; die "That database is empty, which is not what $name uses. Nothing changed."; }
  cp -p "$envf" "$envf.before-dbuser" && chmod 600 "$envf.before-dbuser" && mv "$envf.new" "$envf" && chmod 600 "$envf"
  pm2 restart "$name" --update-env >/dev/null && pm2 save >/dev/null
  sleep 6
  if curl -fsS -m 8 "http://127.0.0.1:$PORT/health" >/dev/null; then
    echo "Done. $name now uses its own database user. The old settings are saved as .env.before-dbuser."
  else
    cp -p "$envf.before-dbuser" "$envf" && pm2 restart "$name" --update-env >/dev/null && pm2 save >/dev/null
    die "$name did not answer after the change, so the old settings were put back."
  fi
}

case "${1:-help}" in
  check) check ;;
  swap) swap ;;
  add) shift; add "$@" ;;
  env) shift; envedit "$@" ;;
  https) shift; https "$@" ;;
  update) shift; update "$@" ;;
  logs) shift; logs "$@" ;;
  safety) safety ;;
  status) status ;;
  backup) backupnow ;;
  restore) shift; restoredb "$@" ;;
  dbuser) shift; dbuser "$@" ;;
  offsite) offsite ;;
  *) sed -n '2,21p' "$0" ;;
esac
