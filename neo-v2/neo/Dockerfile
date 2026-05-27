FROM node:20-alpine

WORKDIR /app

# Install deps first (cache layer)
COPY package*.json ./
RUN npm install --production=false

# Copy source
COPY tsconfig.json ./
COPY src/ ./src/
COPY public/ ./public/

# Build TypeScript
RUN npm run build

# Remove dev deps
RUN npm prune --production

EXPOSE 3000

CMD ["node", "dist/index.js"]
