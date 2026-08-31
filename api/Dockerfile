FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

# server.js imports coach.js, coach-runtime.js and sync.js, and coach.js
# reaches relayer.js. The old line copied server.js alone, so the container
# started and died on "Cannot find module './coach.js'" — a broken image that
# only shows itself at run time, never at build time.
COPY server.js coach.js coach-runtime.js relayer.js sync.js ./

# Where users, passkeys, per-user state and the session secret live. On Render
# this is a mounted disk when one is attached, and ephemeral when it is not —
# see render.yaml.
ENV DATA_DIR=/data
ENV NODE_ENV=production

EXPOSE 3000
CMD ["node", "server.js"]
