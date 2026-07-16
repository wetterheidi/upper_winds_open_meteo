#!/usr/bin/env bash
#
# Deployt DZMaster nach https://dzmaster.wetterheidi.de
#
# - Baut den Web-Build mit base=/ (Subdomain-Root)
# - Legt beim ersten Lauf den nginx-Vhost an und holt das
#   Let's-Encrypt-Zertifikat (idempotent, wird danach übersprungen)
# - Synchronisiert dist/web nach /apps/dzmaster auf dem Server
#
# Aufruf: npm run deploy-hetzner   (oder direkt: bash scripts/deploy-hetzner.sh)

set -euo pipefail

SERVER="root@178.104.206.136"
DOMAIN="dzmaster.wetterheidi.de"
REMOTE_DIR="/apps/dzmaster"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Baue Web-Build (base=/) ..."
cd "$PROJECT_DIR"
npx vite build --base=/

echo "==> Prüfe Server-Setup (nginx-Vhost + Zertifikat) ..."
ssh "$SERVER" bash -s -- "$DOMAIN" "$REMOTE_DIR" <<'REMOTE'
set -euo pipefail
DOMAIN="$1"
REMOTE_DIR="$2"

mkdir -p "$REMOTE_DIR"

if [ ! -f "/etc/nginx/sites-available/$DOMAIN" ]; then
    echo "    Lege nginx-Vhost für $DOMAIN an ..."
    cat > "/etc/nginx/sites-available/$DOMAIN" <<NGINX
server {
    listen 80;
    server_name $DOMAIN;

    root $REMOTE_DIR;
    index index.html;

    # DZMaster ist öffentlich (kein Pfoertner-Gate).

    location / {
        try_files \$uri \$uri/ =404;
    }

    # Versteckte Dateien/Ordner (.git, .env, ...) niemals ausliefern.
    # Ausnahme .well-known (Let's-Encrypt-Validierung).
    location ~ /\.(?!well-known) {
        deny all;
    }
}
NGINX
    ln -sf "../sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
    nginx -t
    systemctl reload nginx

    echo "    Hole Let's-Encrypt-Zertifikat ..."
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect
else
    echo "    Vhost existiert bereits, Setup übersprungen."
fi
REMOTE

echo "==> Synchronisiere dist/web nach $SERVER:$REMOTE_DIR ..."
rsync -avz --delete --delete-excluded --exclude=.DS_Store --exclude=Thumbs.db \
    "$PROJECT_DIR/dist/web/" "$SERVER:$REMOTE_DIR/"

echo "==> Fertig: https://$DOMAIN"
