FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --chown=node:node package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY --chown=node:node src ./src
COPY --chown=node:node test ./test
RUN mkdir -p /app/data && chown node:node /app/data
USER node
CMD ["node", "src/index.mjs"]
