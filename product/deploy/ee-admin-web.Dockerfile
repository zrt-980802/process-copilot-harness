FROM node:22-bookworm-slim AS build
WORKDIR /frontend
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY index.html vite.config.js ./
COPY src ./src
COPY public ./public
ARG VITE_PROCESS_COPILOT_URL
ENV VITE_PROCESS_COPILOT_URL=${VITE_PROCESS_COPILOT_URL}
RUN npm run build

FROM nginx:alpine
COPY --from=build /frontend/dist /usr/share/nginx/html
COPY <<'EOF' /etc/nginx/conf.d/default.conf
server {
  listen 80;
  absolute_redirect off;
  root /usr/share/nginx/html;
  index index.html;
  resolver 127.0.0.11 valid=5s ipv6=off;
  set $ee_backend http://ee-api:5000;
  location /api/internal/ { return 403; }
  location /api/ {
    proxy_set_header Host $http_host;
    proxy_pass $ee_backend;
  }
  location = / { return 302 /access-control; }
  location / { try_files $uri $uri/ /index.html; }
}
EOF
