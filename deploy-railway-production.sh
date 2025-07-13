#!/bin/bash

# Production deployment script for Railway
# Project ID: 5b20490e-c956-4e3d-84d7-24953e600b54

set -e  # Exit on error

echo "🚀 Starting production deployment to Railway..."

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found. Please install it first:"
    echo "npm install -g @railway/cli"
    exit 1
fi

# Generate secure API key if not exists
if [ -z "$EXASOL_API_KEY" ]; then
    echo "🔐 Generating secure API key..."
    EXASOL_API_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    echo "Generated API Key: $EXASOL_API_KEY"
    echo "⚠️  Save this key securely - you'll need it for Vercel!"
fi

# Link to Railway project
echo "🔗 Linking to Railway project..."
railway link 5b20490e-c956-4e3d-84d7-24953e600b54

# Deploy to Railway
echo "📦 Deploying to Railway..."
railway up --environment production

# Set production environment variables
echo "⚙️  Setting production environment variables..."
railway variables set NODE_ENV=production --environment production
railway variables set EXASOL_HOST=6c2pxsycfjdudh5tsy6bb4cqzy.clusters.exasol.com --environment production
railway variables set EXASOL_PORT=8563 --environment production
railway variables set EXASOL_USER=admin --environment production
railway variables set EXASOL_SCHEMA=app_data --environment production
railway variables set POOL_MIN=5 --environment production
railway variables set POOL_MAX=20 --environment production
railway variables set CORS_ORIGINS=https://hana-proxy-vercel.vercel.app --environment production
railway variables set API_KEYS=$EXASOL_API_KEY --environment production

echo ""
echo "⚠️  IMPORTANT: Set these sensitive variables manually in Railway dashboard:"
echo "  - EXASOL_PAT (your Exasol personal access token)"
echo "  - SLACK_WEBHOOK_URL (optional, for alerts)"
echo ""

# Get deployment info
echo "📊 Getting deployment info..."
railway status

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📝 Next steps:"
echo "1. Set EXASOL_PAT in Railway dashboard (Settings → Variables)"
echo "2. Copy the Railway URL from above"
echo "3. Update Vercel environment variables:"
echo "   - EXASOL_PROXY_URL=<railway-url>"
echo "   - EXASOL_API_KEY=$EXASOL_API_KEY"
echo "4. Test the connection:"
echo "   curl <railway-url>/health"
echo ""