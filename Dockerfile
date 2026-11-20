# Stage 1: Build the TypeScript application
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./

RUN npm install

COPY src ./src
COPY test ./test
COPY data ./data
COPY public ./public
COPY skills ./skills

RUN npm run build
RUN npm test > test-output.txt 2>&1 || (cat test-output.txt && exit 1)

# Stage 2: Production runner
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package*.json ./

RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/data ./data
COPY --from=builder /app/public ./public
COPY --from=builder /app/skills ./skills
COPY --from=builder /app/test-output.txt ./test-output.txt

EXPOSE 8080

CMD ["node", "dist/src/index.js"]
