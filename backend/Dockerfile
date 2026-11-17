FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY .sequelizerc ./
COPY src ./src
COPY scripts ./scripts
RUN mkdir -p /app/src/uploads/certificates /app/src/uploads/logos \
    && chown -R node:node /app

USER node
EXPOSE 5001
CMD ["npm", "start"]
