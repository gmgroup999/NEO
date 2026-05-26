FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
# Allow access to Docker socket (GID 110 = docker group on host)
RUN addgroup -g 110 docker && adduser node docker
COPY --from=builder /app/dist ./dist
COPY public ./public
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
