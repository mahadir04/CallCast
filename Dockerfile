# ── STAGE 1: BUILD FRONTEND ──────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

# Install dependencies
COPY frontend/package*.json ./
RUN npm ci

# Copy sources and compile static assets
COPY frontend/ ./
RUN npm run build

# ── STAGE 2: RUNTIME BACKEND ─────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=5000

# Install backend dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --only=production

# Copy backend source and database seeds
COPY backend/ ./backend/

# Copy built frontend assets to the backend's static directory
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Expose single communication port (HTTP + WebSockets)
EXPOSE 5000

# Start server
CMD ["node", "backend/src/app.js"]
