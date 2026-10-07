#!/usr/bin/env bash
# Micro Manager installer for a Linux server (Ubuntu, Debian, etc.) or a Mac with Docker Desktop.
#
#   curl -fsSL https://raw.githubusercontent.com/syntaxless/micro-manager/main/install.sh | bash
#
# It installs Docker if needed, asks for your domain (optional, for automatic HTTPS),
# starts Micro Manager, and keeps it running after reboots. Run it again to update.
# Unattended: set MICRO_MANAGER_DOMAIN (empty for none) to skip the question.
set -euo pipefail

IMAGE="ghcr.io/syntaxless/micro-manager:latest"
DIR="${MICRO_MANAGER_DIR:-$HOME/micro-manager}"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
# Read answers from the terminal even when this script is piped into bash.
ask() {
  local reply=''
  if [ -n "${MICRO_MANAGER_DOMAIN+x}" ]; then printf '%s' "$MICRO_MANAGER_DOMAIN"; return; fi
  { read -r -p "$1" reply </dev/tty; } 2>/dev/null || true
  printf '%s' "$reply"
}

bold "Micro Manager installer"
echo

if ! command -v docker >/dev/null 2>&1; then
  if [ "$(uname -s)" = "Darwin" ]; then
    fail "Please install Docker Desktop first (https://www.docker.com/products/docker-desktop/), open it once, then run this again."
  fi
  info "Docker isn't installed yet. Installing it now (this takes a minute or two)…"
  curl -fsSL https://get.docker.com | sh >/dev/null
  if [ "$(id -u)" -ne 0 ]; then sudo usermod -aG docker "$USER" || true; fi
fi

DOCKER="docker"
if ! docker info >/dev/null 2>&1; then
  if sudo -n docker info >/dev/null 2>&1 || sudo docker info >/dev/null 2>&1; then
    DOCKER="sudo docker"
  else
    fail "Docker is installed but not running. Start Docker, then run this again."
  fi
fi

mkdir -p "$DIR"
cd "$DIR"

if [ -f docker-compose.yml ]; then
  info "Existing install found in $DIR. Updating to the latest version…"
  $DOCKER compose pull -q || $DOCKER image inspect "$IMAGE" >/dev/null
  $DOCKER compose up -d
  echo
  bold "Updated. Your data was kept."
  exit 0
fi

echo "Do you have a domain name for this (for example studio.yourname.com)?"
echo "If you do, point it at this server's IP address first, and you'll get HTTPS automatically."
DOMAIN="$(ask 'Domain (leave empty to skip): ')"
DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN%%/*}"

if [ -n "$DOMAIN" ]; then
  cat > docker-compose.yml <<EOF
services:
  micro-manager:
    image: $IMAGE
    restart: unless-stopped
    environment:
      TRUST_PROXY: "true"
      APP_URL: https://$DOMAIN
    volumes:
      - ./data:/data
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    command: caddy reverse-proxy --from $DOMAIN --to micro-manager:3000
    volumes:
      - ./caddy:/data
EOF
  URL="https://$DOMAIN"
else
  cat > docker-compose.yml <<EOF
services:
  micro-manager:
    image: $IMAGE
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
EOF
  HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  URL="http://${HOST_IP:-localhost}:3000"
fi

mkdir -p data
# The app runs as an unprivileged user inside the container.
chown 1000:1000 data 2>/dev/null || sudo chown 1000:1000 data 2>/dev/null || true

info "Downloading and starting Micro Manager…"
$DOCKER compose pull -q || $DOCKER image inspect "$IMAGE" >/dev/null
$DOCKER compose up -d

printf '  Waiting for it to start'
for _ in $(seq 1 30); do
  if $DOCKER compose exec -T micro-manager wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo
    echo
    bold "Micro Manager is running."
    echo
    echo "  Open $URL in your browser to create your account."
    echo
    echo "  Your data lives in $DIR/data. Back up that folder to keep everything safe."
    echo "  To update later, run this installer again."
    exit 0
  fi
  printf '.'
  sleep 2
done
echo
fail "It's taking longer than expected. Check what happened with: cd $DIR && $DOCKER compose logs"
