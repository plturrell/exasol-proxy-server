FROM node:18-alpine

WORKDIR /app

# Install dependencies - using npm install for Railway
COPY package.json ./
RUN npm install --omit=dev

# Copy source
COPY index.js ./
COPY src ./src

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001
USER nodejs

EXPOSE 3000

CMD ["node", "src/server.js"]