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

case "${1:-help}" in
  check) check ;;
  swap) swap ;;
  add) shift; add "$@" ;;
  env) shift; envedit "$@" ;;
  https) shift; https "$@" ;;
  update) shift; update "$@" ;;
  logs) shift; logs "$@" ;;
  *) sed -n '2,15p' "$0" ;;
esac
