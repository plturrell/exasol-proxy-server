# DigitalOcean Deployment Guide

## Quick Deploy (5 minutes)

### 1. Create DigitalOcean Droplet

1. Go to [DigitalOcean](https://cloud.digitalocean.com/droplets/new)
2. Choose:
   - **Image**: Ubuntu 22.04 LTS
   - **Plan**: Basic ($6/month - 1 vCPU, 1GB RAM)
   - **Datacenter**: Choose closest to your location
   - **Authentication**: SSH Key (recommended)
3. Click "Create Droplet"
4. Note your droplet IP address

### 2. SSH into Droplet

```bash
ssh root@YOUR_DROPLET_IP
```

### 3. Run Setup Script

Copy and paste this entire script into your SSH session:

```bash
#!/bin/bash

# Update system
apt update && apt upgrade -y

# Install Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt install -y nodejs

# Install PM2 and git
npm install -g pm2
apt install -y git

# Create app directory
mkdir -p /var/app
cd /var/app

# Clone repository
git clone https://github.com/plturrell/exasol-proxy-server.git
cd exasol-proxy-server

# Install dependencies
npm install --production

# Setup environment
cat > .env << 'EOF'
EXASOL_HOST=6c2pxsycfjdudh5tsy6bb4cqzy.clusters.exasol.com
EXASOL_PORT=8563
EXASOL_USER=admin
EXASOL_PAT=
EXASOL_SCHEMA=app_data
API_KEYS=
CORS_ORIGINS=https://hana-proxy-vercel.vercel.app
NODE_ENV=production
PORT=3000
EOF

# Setup PM2 config
cat > ecosystem.config.js << 'EOF'
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
    }
  }]
};
EOF

# Setup firewall
ufw allow 22
ufw allow 80
ufw allow 3000
ufw --force enable

# Install and configure nginx
apt install -y nginx
cat > /etc/nginx/sites-available/exasol-proxy << 'EOF'
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
    }
}
EOF

ln -s /etc/nginx/sites-available/exasol-proxy /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default
systemctl restart nginx

echo "=== Setup Complete! ==="
echo "Edit /var/app/exasol-proxy-server/.env to add your credentials"
```

### 4. Configure Environment Variables

```bash
cd /var/app/exasol-proxy-server
nano .env
```

Add your actual values:
- `EXASOL_PAT=your_exasol_pat_token`
- `API_KEYS=your_api_key_1,your_api_key_2`

### 5. Start the Service

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root
```

### 6. Test the Deployment

```bash
# Test local connection
curl http://localhost:3000/health

# Test external connection (from your computer)
curl http://YOUR_DROPLET_IP/health
```

## Your Proxy URLs

- **Primary**: `http://YOUR_DROPLET_IP`
- **Direct**: `http://YOUR_DROPLET_IP:3000`
- **Health**: `http://YOUR_DROPLET_IP/health`

## Management Commands

```bash
# View logs
pm2 logs exasol-proxy

# Restart service
pm2 restart exasol-proxy

# Stop service
pm2 stop exasol-proxy

# View status
pm2 status
```

## Update Vercel Environment

After deployment, update your Vercel environment variables:

```
EXASOL_PROXY_URL=http://YOUR_DROPLET_IP
EXASOL_API_KEY=your_api_key_here
```

## Cost

- DigitalOcean Basic Droplet: $6/month
- Full control over networking (port 8563 access)
- 1TB transfer included