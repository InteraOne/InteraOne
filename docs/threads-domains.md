# Threads domains

## One-time deployment setup

The deployment administrator prepares the shared domain infrastructure once. Founders do not edit environment variables or proxy configuration for each customer domain.

For the bundled Docker stack, configure `API_URL_PRODUCTION` with the public hostname that resolves to the machine running Caddy. The Gateway uses that hostname as the CNAME value shown in the founder dashboard. Configure its A/AAAA record, point ports 80 and 443 at Caddy, and set `THREADS_TLS_MODE=on-demand`. Caddy's catch-all HTTPS site proxies `/api/*` to Gateway and the portal UI to Console. Its on-demand certificate permission endpoint checks the database for a verified domain belonging to an active organization with Threads enabled. Certificates and keys persist in the `caddy_data` volume. The widget `launcher-deploy` service only uploads widget JavaScript; it does not provide portal hosting or certificates.

If a cloud load balancer or CDN terminates TLS, use `THREADS_TLS_MODE=external`. The administrator must configure that edge to accept arbitrary verified customer hostnames, provision trusted certificates, route the portal and `/api/v1/threads/host/*` to the existing Console and Gateway, and preserve the original `Host` header. A CNAME target by itself does not make a cloud edge support arbitrary hosts. Use `disabled` until this infrastructure is ready. The dashboard shows DNS-only status in that mode and never labels a domain active.

Configure the Gateway's `CLIENT_URL` for the default Console portal link and `PUBLIC_API_URL` for uploaded logos and the custom-domain CNAME target. Recreate the Gateway and Caddy containers after changing deployment settings. Keep `caddy_data` persistent across restarts. The admin can validate the Caddyfile with `caddy validate --config /etc/caddy/Caddyfile` inside the Caddy image.

## Founder setup

In **Threads → Domains**, enter a subdomain such as `support.company.com`. The dashboard immediately gives you a unique TXT record at `_interaone-challenge.support.company.com` to establish ownership. Once the deployment administrator configures a public target, it also shows the required CNAME. Click **Check DNS & TLS** after DNS propagates. The Gateway checks the live TXT and CNAME responses. Once both match, Caddy can request a certificate on the next TLS handshake. The verification action checks the publicly trusted certificate for that hostname and marks the domain active only after HTTPS succeeds. If the certificate is still provisioning, wait and check again. Existing hosted portal links continue to work throughout.

The custom domain serves its own `/api/v1/threads/host` endpoints over the same origin. Gateway resolves the tenant from the HTTP `Host` header; the browser cannot select another organization by sending a separate tenant header. Private threads still require their organization's customer email session.
