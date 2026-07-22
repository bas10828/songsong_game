# Zero-dependency static file server (see server.js) — no build step, no npm install needed.
FROM node:20-alpine
WORKDIR /app
COPY . .
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
