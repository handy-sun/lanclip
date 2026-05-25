FROM node:22.12-alpine3.21 AS builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:22.12-alpine3.21
WORKDIR /app/server-node
COPY server-node/package*.json ./
RUN npm ci --omit=dev
COPY server-node/ ./
COPY --from=builder /app/client/dist/ ./static/
EXPOSE 9501
CMD ["node", "main.js"]
