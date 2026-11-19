# syntax=docker/dockerfile:1

# --- Dépendances : couche mise en cache tant que package-lock.json ne change pas.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# --- Build. NEXT_PUBLIC_* sont figées dans le bundle JS au build (visibles du navigateur) :
# elles doivent être passées en build args (Coolify le fait pour les variables déclarées en ARG).
FROM node:22-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_API_KEY
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_API_KEY=$NEXT_PUBLIC_API_KEY \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- Image finale : uniquement le serveur "standalone" (node_modules réduits au strict nécessaire).
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# L'utilisateur "node" (uid 1000) existe déjà dans l'image : pas de root à l'exécution.
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -q --spider http://127.0.0.1:3000/ || exit 1
CMD ["node", "server.js"]
