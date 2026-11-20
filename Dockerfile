FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json yarn.lock ./

RUN yarn install --frozen-lockfile

COPY . .

RUN yarn build

# Só dependências de produção: a imagem final não leva ferramentas de
# desenvolvimento (jest, ts-loader, @nestjs/cli) nem as vulnerabilidades delas.
FROM node:24-alpine AS deps

WORKDIR /app

COPY package.json yarn.lock ./

RUN yarn install --frozen-lockfile --production

FROM node:24-alpine

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
COPY package.json yarn.lock ./

RUN chown -R node:node /app

USER node

EXPOSE 3000

CMD ["yarn", "start:prod"]