# Static file server (see server.js) — no build step, but question-sets
# storage now needs the `pg` runtime dependency.
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev
COPY . .
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
