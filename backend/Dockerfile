FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY server.js ./
COPY lib ./lib
COPY views ./views
COPY public ./public
ENV NODE_ENV=production
ENV DATA_DIR=/data
EXPOSE 3000
CMD ["node", "server.js"]
