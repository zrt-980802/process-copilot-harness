FROM nginx:alpine
COPY apps/web/dist /usr/share/nginx/html
COPY deploy/nginx.workbench-demo.conf /etc/nginx/conf.d/default.conf
