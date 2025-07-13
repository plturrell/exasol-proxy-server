# Deploying to Render

## Quick Deploy

1. Push this code to GitHub (already done)
2. Go to [render.com](https://render.com)
3. Click "New +" → "Web Service"
4. Connect your GitHub account and select the `exasol-proxy-server` repository
5. Configure the service:
   - **Name**: exasol-proxy-server
   - **Region**: Choose closest to your location
   - **Branch**: main
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node src/server.js`

## Environment Variables

Add these in the Render dashboard:

```
EXASOL_HOST=6c2pxsycfjdudh5tsy6bb4cqzy.clusters.exasol.com
EXASOL_PORT=8563
EXASOL_USER=admin
EXASOL_PAT=[your-exasol-pat-token]
EXASOL_SCHEMA=app_data
API_KEYS=[your-api-keys-comma-separated]
CORS_ORIGINS=https://hana-proxy-vercel.vercel.app
NODE_ENV=production
```

## After Deployment

1. Your proxy will be available at: `https://exasol-proxy-server.onrender.com`
2. Test the health endpoint: `https://exasol-proxy-server.onrender.com/health`
3. Update your Vercel environment variables:
   - `EXASOL_PROXY_URL=https://exasol-proxy-server.onrender.com`
   - `EXASOL_API_KEY=[one-of-your-api-keys]`

## Monitoring

- Check logs in Render dashboard
- Health endpoint: `/health`
- Test connection: `/test-connection`
- Network diagnostics: `/network-test`