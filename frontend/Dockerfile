FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
RUN apk add --no-cache openssl \
 && mkdir -p /etc/nginx/certs \
 && openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
      -keyout /etc/nginx/certs/tls.key \
      -out /etc/nginx/certs/tls.crt \
      -subj "/C=MX/ST=Chiapas/O=UNACH/CN=localhost" \
      -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
COPY nginx-tls.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80 443
