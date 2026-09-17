# Etapa 1: compila TypeScript con todas las dependencias (incluidas las de desarrollo).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

# Etapa 2: imagen final, solo con dependencias de producción y el código compilado.
# npm ci corre dentro del contenedor Linux, así sharp instala su binario de Linux.
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force
COPY --from=build /app/dist ./dist
# Certificados de AWS para verificar la conexión cifrada con RDS. Sin --chmod, Docker
# dejaría el archivo legible solo por root y el usuario node no podría leerlo.
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem certs/rds-global-bundle.pem
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
