#!/usr/bin/env python3
"""Erzeugt hetzner-cloud-config.yaml: Einrichtung eines neuen Hetzner-Servers (Ubuntu 24.04).
Der Server holt den Code von GitHub und aktualisiert sich danach selbst (update.sh)."""
import textwrap

REPO = "https://github.com/ostash-cod/Spur.git"

setup = f'''#!/bin/bash
# Richtet Spur auf diesem Server ein. Protokoll: /var/log/spur-setup.log
exec > >(tee -a /var/log/spur-setup.log) 2>&1
set -eux

curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs git

id spur >/dev/null 2>&1 || useradd --system --home /var/lib/spur --shell /usr/sbin/nologin spur
mkdir -p /var/lib/spur
git clone --branch main {REPO} /opt/spur
cd /opt/spur/server
npm install --omit=dev --no-audit --no-fund
chown -R spur:spur /var/lib/spur
chmod +x /opt/spur/deploy/update.sh

systemctl daemon-reload
systemctl enable --now spur
systemctl enable --now spur-update.timer

IP=$(curl -4 -fsS http://169.254.169.254/hetzner/v1/metadata/public-ipv4 || curl -4 -fsS https://api.ipify.org)
HOST="${{IP//./-}}.sslip.io"
cat > /etc/caddy/Caddyfile <<CADDY
$HOST {{
    encode gzip
    reverse_proxy 127.0.0.1:3000
}}
CADDY
systemctl restart caddy

ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

for i in $(seq 1 30); do
  [ -f /var/lib/spur/erster-zugang.txt ] && break
  sleep 2
done

{{
  echo
  echo "=================== SPUR IST FERTIG ==================="
  echo "Adresse fuer die Handy-App und den Browser:"
  echo "https://$HOST"
  echo
  cat /var/lib/spur/erster-zugang.txt
  echo "========================================================"
}} | tee /dev/console /dev/tty1 >/dev/null 2>&1 || true
'''

spur_service = '''[Unit]
Description=Spur Server
After=network.target

[Service]
User=spur
WorkingDirectory=/opt/spur/server
Environment=SPUR_DATA_DIR=/var/lib/spur
Environment=PORT=3000
Environment=HOST=127.0.0.1
Environment=SPUR_TRUST_PROXY=1
ExecStart=/usr/bin/node --no-warnings src/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/lib/spur

[Install]
WantedBy=multi-user.target
'''

update_service = '''[Unit]
Description=Spur: neue Version von GitHub holen
After=network-online.target

[Service]
Type=oneshot
ExecStart=/opt/spur/deploy/update.sh
'''

update_timer = '''[Unit]
Description=Spur: alle 5 Minuten nach einer neuen Version sehen

[Timer]
OnBootSec=5min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
'''

ind = lambda s: textwrap.indent(s, ' ' * 6)

yaml = f'''#cloud-config
# Spur (von Wladi) - Einrichtung fuer einen neuen Hetzner-Server (Ubuntu 24.04)
package_update: true
packages:
  - caddy
  - curl
  - ca-certificates
  - ufw
write_files:
  - path: /etc/systemd/system/spur.service
    permissions: '0644'
    content: |
{ind(spur_service)}
  - path: /etc/systemd/system/spur-update.service
    permissions: '0644'
    content: |
{ind(update_service)}
  - path: /etc/systemd/system/spur-update.timer
    permissions: '0644'
    content: |
{ind(update_timer)}
  - path: /opt/spur-setup.sh
    permissions: '0755'
    content: |
{ind(setup)}
runcmd:
  - [ bash, /opt/spur-setup.sh ]
'''
open('hetzner-cloud-config.yaml', 'w').write(yaml)
print(len(yaml.encode()), 'Bytes')
