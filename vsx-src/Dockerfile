FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    librsvg2-bin \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @vscode/vsce ovsx

WORKDIR /extension

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VSIX_VERSION=0.0.0
RUN node -e " \
  const p = JSON.parse(require('fs').readFileSync('package.json', 'utf8')); \
  p.version = process.env.VSIX_VERSION || '0.0.0'; \
  require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2));"

RUN npm run compile
RUN mkdir -p /out && vsce package -o /out/
