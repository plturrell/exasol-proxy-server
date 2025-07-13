#!/bin/bash
# DigitalOcean Deployment Script for Exasol Proxy Server

echo "=== DigitalOcean Exasol Proxy Deployment ==="
echo ""
echo "This script will help you deploy the proxy to a DigitalOcean Droplet"
echo ""

# Server setup commands to run after creating droplet
cat > setup-server.sh << 'EOF'
#!/bin/bash

# Update system
apt update && apt upgrade -y

# Install Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt install -y nodejs

# Install PM2 for process management
npm install -g pm2

# Install git
apt install -y git

# Create app directory
mkdir -p /var/app
cd /var/app

# Clone the repository
git clone https://github.com/plturrell/exasol-proxy-server.git
cd exasol-proxy-server

# Install dependencies
npm install --production

# Setup environment variables
cat > .env << 'ENVFILE'
EXASOL_HOST=6c2pxsycfjdudh5tsy6bb4cqzy.clusters.exasol.com
EXASOL_PORT=8563
EXASOL_USER=admin
EXASOL_PAT=YOUR_EXASOL_PAT_HERE
EXASOL_SCHEMA=app_data
API_KEYS=YOUR_API_KEYS_HERE
CORS_ORIGINS=https://hana-proxy-vercel.vercel.app
NODE_ENV=production
PORT=3000
ENVFILE

# Setup PM2 ecosystem file
cat > ecosystem.config.js << 'PM2CONFIG'
module.exports = {
  apps: [{
    name: 'exasol-proxy',
    script: './src/server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production'
    },
    error_file: '/var/log/pm2/exasol-proxy-error.log',
    out_file: '/var/log/pm2/exasol-proxy-out.log',
    log_file: '/var/log/pm2/exasol-proxy-combined.log',
    time: true
  }]
};
PM2CONFIG

# Create log directory
mkdir -p /var/log/pm2

# Setup firewall
ufw allow 22
ufw allow 80
ufw allow 443
ufw allow 3000
ufw --force enable

# Install nginx for reverse proxy (optional)
apt install -y nginx

# Configure nginx
cat > /etc/nginx/sites-available/exasol-proxy << 'NGINX'
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }

    location /health {
        proxy_pass http://localhost:3000/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        access_log off;
    }
}
NGINX

# Enable nginx site
ln -s /etc/nginx/sites-available/exasol-proxy /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

# Start the application with PM2
cd /var/app/exasol-proxy-server
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root

echo ""
echo "=== Setup Complete! ==="
echo ""
echo "IMPORTANT: Edit /var/app/exasol-proxy-server/.env to add:"
echo "  - EXASOL_PAT"
echo "  - API_KEYS"
echo ""
echo "Then restart with: pm2 restart exasol-proxy"
echo ""
echo "Your proxy is available at:"
echo "  - http://YOUR_DROPLET_IP"
echo "  - http://YOUR_DROPLET_IP:3000 (direct)"
echo ""
echo "View logs with: pm2 logs exasol-proxy"
echo ""
EOF

echo "=== DigitalOcean Droplet Creation Steps ==="
echo ""
echo "1. Go to https://cloud.digitalocean.com/droplets/new"
echo ""
echo "2. Choose droplet configuration:"
echo "   - Image: Ubuntu 22.04 LTS"
echo "   - Plan: Basic"
echo "   - CPU: Regular (1 vCPU, 1GB RAM is enough)"
echo "   - Datacenter: Choose closest to you"
echo "   - Authentication: SSH Key (recommended) or Password"
echo ""
echo "3. After droplet is created, SSH into it:"
echo "   ssh root@YOUR_DROPLET_IP"
echo ""
echo "4. Run the setup script:"
echo "   Copy and paste the contents of setup-server.sh"
echo "   OR upload this file and run: bash setup-server.sh"
echo ""
echo "5. Configure environment variables"
echo "6. Your proxy will be running!"
echo ""
echo "Setup script saved to: setup-server.sh"