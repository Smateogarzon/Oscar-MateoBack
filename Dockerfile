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
# Evita el aviso "New major version of npm available" en cada comando y en los logs.
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force
COPY --from=build /app/dist ./dist
# Certificados de AWS para verificar la conexión cifrada con RDS. ADD los deja legibles
# solo por root, y ADD --chmod también le quita a la carpeta el permiso de entrar, así
# que los permisos se ajustan aparte para que el usuario node pueda leerlos.
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem certs/rds-global-bundle.pem
RUN chmod 755 certs && chmod 644 certs/rds-global-bundle.pem
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
