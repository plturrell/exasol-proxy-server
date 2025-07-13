#!/bin/bash

# Railway deployment script for Exasol proxy server
# Project ID: 5b20490e-c956-4e3d-84d7-24953e600b54

echo "🚂 Deploying Exasol proxy to Railway..."

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found. Installing..."
    npm install -g @railway/cli
fi

# Copy WebSocket client
echo "📋 Copying WebSocket client..."
cp ../api/exasol-websocket-client.js ./

# Link to the project
echo "🔗 Linking to Railway project..."
railway link 5b20490e-c956-4e3d-84d7-24953e600b54

# Set environment variables
echo "🔧 Setting environment variables..."
railway variables set EXASOL_HOST=6c2pxsycfjdudh5tsy6bb4cqzy.clusters.exasol.com
railway variables set EXASOL_PORT=8563
railway variables set EXASOL_USER=admin
railway variables set EXASOL_SCHEMA=app_data
railway variables set NODE_ENV=production

# Note: Set EXASOL_PAT manually in Railway dashboard for security
echo "⚠️  Remember to set EXASOL_PAT in Railway dashboard!"

# Deploy
echo "🚀 Deploying to Railway..."
railway up

# Get the deployment URL
echo "✅ Deployment complete!"
echo "🌐 Getting deployment URL..."
railway status

echo ""
echo "📝 Next steps:"
echo "1. Set EXASOL_PAT environment variable in Railway dashboard"
echo "2. Update EXASOL_PROXY_URL in Vercel with the Railway URL"
echo "3. Test the connection using the /health endpoint"