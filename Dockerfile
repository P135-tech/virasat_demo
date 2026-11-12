FROM node:22-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

# Build tools (vite) are dev dependencies, so install everything, build, then remove them.
# npm install (not npm ci) so it works even before a package-lock.json is committed.
RUN npm install --include=dev

COPY . .

RUN npm run build && npm prune --omit=dev && npm cache clean --force

CMD ["npm", "run", "docker-start"]
