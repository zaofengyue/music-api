# 阶段一：使用 @vercel/ncc 编译打包为单文件
FROM node:20-alpine AS builder
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
RUN npm run build

# 阶段二：极简生产运行环境（无 node_modules，镜像体积小、安全性高）
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8100 \
    IP=0.0.0.0

COPY --from=builder /build/dist/index.js ./app.js

USER node
EXPOSE 8100

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/ || exit 1

CMD ["node", "app.js"]
