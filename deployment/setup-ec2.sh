#!/usr/bin/env bash
# =============================================================================
# ITOps — One-time EC2 setup script (Amazon Linux 2023)
#
# Run this once on a fresh instance as ec2-user:
#   bash setup-ec2.sh
#
# After it completes:
#   1. Edit /opt/itops/backend/.env  (set GEMINI_API_KEY + CORS_ALLOW_ORIGINS)
#   2. Add GitHub Secrets (EC2_HOST, EC2_SSH_PRIVATE_KEY, EC2_USER)
#   3. Push to main → CI/CD deploys the code automatically
#   4. sudo systemctl start itops-backend
# =============================================================================
set -euo pipefail

APP_DIR="/opt/itops"
VENV_DIR="$APP_DIR/venv"
# Detect the calling user whether run with sudo or directly
EC2_USER="${SUDO_USER:-$(whoami)}"

echo "============================================="
echo " ITOps — EC2 Setup  (Amazon Linux 2023)"
echo "============================================="
echo " App directory : $APP_DIR"
echo " Virtualenv    : $VENV_DIR"
echo " Running as    : $EC2_USER"
echo ""

# ── 1. System packages ─────────────────────────────────────────────
echo "[1/6] Installing system packages..."
sudo dnf update -y -q
sudo dnf install -y -q python3.11 python3.11-pip git nginx

# ── 2. App directory structure ─────────────────────────────────────
echo "[2/6] Creating directory structure..."
sudo mkdir -p "$APP_DIR/backend" "$APP_DIR/frontend/dist"
sudo chown -R "$EC2_USER:$EC2_USER" "$APP_DIR"

# ── 3. Python virtual environment ──────────────────────────────────
echo "[3/6] Creating Python virtualenv..."
python3.11 -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --quiet --upgrade pip
echo "      Virtualenv ready at $VENV_DIR"

# ── 4. Nginx ───────────────────────────────────────────────────────
echo "[4/6] Configuring nginx..."

# Remove the default server block that ships with nginx on AL2023
sudo rm -f /etc/nginx/conf.d/default.conf

sudo tee /etc/nginx/conf.d/itops.conf > /dev/null << 'NGINXEOF'
server {
    listen 80;
    server_name _;

    # Serve the built React app
    root /opt/itops/frontend/dist;
    index index.html;

    # WebSocket — live metrics stream
    location /ws/ {
        proxy_pass         http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       $host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # REST API
    location /api/ {
        proxy_pass         http://127.0.0.1:8000;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout    120s;
        proxy_connect_timeout  10s;
        proxy_send_timeout    120s;
    }

    # FastAPI built-in endpoints
    location ~ ^/(docs|redoc|openapi\.json|health)$ {
        proxy_pass       http://127.0.0.1:8000;
        proxy_set_header Host $host;
    }

    # React Router fallback — serve index.html for all client-side routes
    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINXEOF

sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx
echo "      Nginx configured and started."

# ── 5. systemd service ─────────────────────────────────────────────
echo "[5/6] Creating systemd service (itops-backend)..."

# The heredoc delimiter is unquoted so $APP_DIR/$VENV_DIR/$EC2_USER expand.
sudo tee /etc/systemd/system/itops-backend.service > /dev/null << SVCEOF
[Unit]
Description=ITOps Backend (FastAPI / Uvicorn)
After=network.target

[Service]
Type=simple
User=$EC2_USER
Group=$EC2_USER
WorkingDirectory=$APP_DIR/backend
EnvironmentFile=$APP_DIR/backend/.env
Environment=PYTHONUNBUFFERED=1
Environment=PYTHONDONTWRITEBYTECODE=1
ExecStart=$VENV_DIR/bin/uvicorn app.main:app \\
    --host 127.0.0.1 \\
    --port 8000 \\
    --workers 1 \\
    --log-level info
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=itops-backend

[Install]
WantedBy=multi-user.target
SVCEOF

sudo systemctl daemon-reload
sudo systemctl enable itops-backend
echo "      Service registered. Will start after first deploy."

# ── 6. Sudoers — allow ec2-user to restart services without password
# GitHub Actions SSHs in as ec2-user and needs to restart services.
echo "[6/6] Configuring passwordless sudo for service management..."
sudo tee /etc/sudoers.d/itops > /dev/null << SUDOEOF
$EC2_USER ALL=(ALL) NOPASSWD: \
  /usr/bin/systemctl restart itops-backend, \
  /usr/bin/systemctl start itops-backend, \
  /usr/bin/systemctl stop itops-backend, \
  /usr/bin/systemctl status itops-backend, \
  /usr/bin/systemctl reload nginx, \
  /usr/bin/systemctl daemon-reload, \
  /usr/bin/nginx -t
SUDOEOF
sudo chmod 440 /etc/sudoers.d/itops
echo "      Sudoers rule written."

# ── Create .env from sample if it doesn't exist ────────────────────
if [ ! -f "$APP_DIR/backend/.env" ]; then
    cat > "$APP_DIR/backend/.env" << 'ENVEOF'
LLM_PROVIDER=gemini
GEMINI_API_KEY=your-gemini-api-key-here
GEMINI_MODEL=gemini-2.5-flash

OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini

OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b
OLLAMA_EMBEDDING_MODEL=nomic-embed-text

# Replace with your EC2 public IP or domain
CORS_ALLOW_ORIGINS=http://YOUR_EC2_PUBLIC_IP

SIMULATOR_INTERVAL_SECONDS=10
NUM_SIMULATED_SERVERS=6
ANOMALY_PROBABILITY=0.15
AGENT_TEMPERATURE=0.1
PIPELINE_MAX_CONCURRENT=4
ENVEOF
fi

# ── Done ───────────────────────────────────────────────────────────
PUBLIC_IP=$(curl -sf http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo "<your-ec2-ip>")

echo ""
echo "============================================="
echo " Setup complete!"
echo "============================================="
echo ""
echo " NEXT STEPS:"
echo ""
echo " 1. Edit your .env file:"
echo "      nano $APP_DIR/backend/.env"
echo "    → Set GEMINI_API_KEY=<your key>"
echo "    → Set CORS_ALLOW_ORIGINS=http://$PUBLIC_IP"
echo ""
echo " 2. Add these 3 secrets to your GitHub repo:"
echo "    Settings → Secrets → Actions → New repository secret"
echo "      EC2_HOST              = $PUBLIC_IP"
echo "      EC2_USER              = $EC2_USER"
echo "      EC2_SSH_PRIVATE_KEY   = <contents of your .pem key file>"
echo ""
echo " 3. EC2 Security Group — ensure inbound rules allow:"
echo "      Port 22   (SSH)   — your IP"
echo "      Port 80   (HTTP)  — 0.0.0.0/0"
echo ""
echo " 4. Push to main → GitHub Actions deploys the app."
echo ""
echo " 5. After the first deploy, the service starts automatically."
echo "    Check with: sudo systemctl status itops-backend"
echo "    Logs with:  sudo journalctl -u itops-backend -f"
echo ""
echo " App URL: http://$PUBLIC_IP"
echo " API docs: http://$PUBLIC_IP/docs"
echo "============================================="
