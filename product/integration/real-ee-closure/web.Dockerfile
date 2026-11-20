ARG NGINX_IMAGE
FROM ${NGINX_IMAGE}
COPY apps/web/dist /usr/share/nginx/html
COPY integration/real-ee-closure/nginx.conf /etc/nginx/conf.d/default.conf
