FROM node:22.12-alpine3.21 AS builder
COPY . /app
WORKDIR /app/client
RUN npm ci
RUN npm run build

FROM node:22.12-alpine3.21
COPY . /app
COPY --from=builder /app/client/dist/ /app/server-node/static/
WORKDIR /app/server-node
RUN npm ci
EXPOSE 9501
CMD ["node", "main.js"]
