# MobFleet MJPEG stream relay — a small WSS↔multipart bridge. No video is persisted; anon key only.
# Agent connects outbound (WSS /publish); browsers view (HTTP multipart /stream). NOT the Railway backend.
FROM node:20-alpine
WORKDIR /app

# Install deps (ws + tsx runtime). No lockfile is committed, so npm install resolves at build time.
COPY package.json ./
RUN npm install --no-audit --no-fund

# App source — TypeScript, run directly via tsx (see package.json "start").
COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
ENV PORT=8090
EXPOSE 8090

# Runtime config (NOT baked in): SUPABASE_URL + SUPABASE_ANON_KEY (no service-role key). Provide via
# `fly secrets set …` or `-e`. Health: GET /health.
CMD ["npm", "start"]
