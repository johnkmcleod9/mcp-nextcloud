# Multi-Agent MCP with Secure External Access — Design Spec

## Goal

Enable multiple Nextcloud MCP agent personas (e.g., assistant, marketing, finance) running as isolated Docker containers, with secure bearer-token-authenticated external access for Claude Code, Claude Desktop, and openclaw via Traefik path-based routing.

## Architecture

```
External Clients (Claude Code, Desktop, openclaw)
        │ HTTPS + Bearer Token
        ▼
    Traefik (TLS termination, path-based routing)
        │
        ├─ /assistant/*  → mcp-nc-assistant  (ai-assistant account)
        ├─ /marketing/*  → mcp-nc-marketing  (ai-marketing account)
        └─ /finance/*    → mcp-nc-finance    (ai-finance account)

Internal (Open WebUI)
        │ HTTP direct (Docker network, no token required)
        ├─ mcp-nc-assistant:8080/mcp
        ├─ mcp-nc-marketing:8080/mcp
        └─ mcp-nc-finance:8080/mcp
        │
        ▼
    Nextcloud (internal, http://nextcloud-aio-apache:11000)
```

### Key Principles

- **One container per agent.** Same Docker image, different env vars. Complete process isolation. Each container runs its own Node.js process with its own MCP server + transport instance, so there are no shared-state concurrency concerns.
- **Auth in the server code.** Bearer token validation in `http-server.ts`, not just at the proxy layer. Defense in depth.
- **Private network bypass.** Internal clients (Open WebUI) skip token auth automatically. No tokens to manage for internal use.
- **Path-based routing.** Single domain (`mcp.canspace.ca`), one TLS cert, Traefik strips prefix before forwarding.

---

## 1. Bearer Token Authentication

### Implementation

Add auth middleware to `http-server.ts` that validates bearer tokens on the `/mcp` endpoint.

**Environment variables:**

| Variable | Default | Description |
|---|---|---|
| `MCP_AUTH_TOKEN` | (unset) | Comma-separated list of valid bearer tokens. If unset, auth is disabled. |
| `MCP_AUTH_BYPASS_PRIVATE` | `true` | Skip auth for requests from private IPs (172.x, 10.x, 192.168.x). |

**Express trust proxy configuration:**

Add `app.set('trust proxy', 'loopback,linklocal,uniquelocal')` so that `req.ip` reflects the real client IP from `X-Forwarded-For` when requests come through Traefik.

**Private IP bypass logic:**

When `MCP_AUTH_BYPASS_PRIVATE` is `true`, the middleware checks whether `X-Forwarded-For` header is present:
- If `X-Forwarded-For` is **absent**: the request came directly (not through Traefik), meaning it's from the Docker network (Open WebUI). Auth is bypassed.
- If `X-Forwarded-For` is **present**: the request came through Traefik (external). Auth is required regardless of the source IP.

This approach is safe because only Traefik adds `X-Forwarded-For`, and Docker network clients (Open WebUI) connect directly without a proxy.

**Behavior:**

- If `MCP_AUTH_TOKEN` is not set: all requests allowed (backward compatible).
- If set: `/mcp` requests must include `Authorization: Bearer <token>` header.
- If `MCP_AUTH_BYPASS_PRIVATE` is `true` and no `X-Forwarded-For` header: auth is skipped (internal request).
- `/health` endpoint remains unauthenticated (for Docker health checks).
- `/analytics` and `/analytics/dashboard` require bearer token auth when `MCP_AUTH_TOKEN` is set (these expose operational data that should not be public).
- Failed auth is logged with source IP and timestamp, then returns HTTP 401 with JSON-RPC error:
  ```json
  {
    "jsonrpc": "2.0",
    "error": { "code": -32600, "message": "Unauthorized: invalid or missing bearer token" },
    "id": null
  }
  ```

**Token comparison:** Use `crypto.timingSafeEqual` for constant-time comparison to prevent timing attacks.

**Query-param credential override:** Disable the existing `initializeCredentials(req)` query-param credential override when `MCP_AUTH_TOKEN` is set. When auth is enabled, credentials come exclusively from environment variables. This prevents a valid token holder from redirecting the server to a different Nextcloud instance.

### Token Management

- Tokens are random 64-character hex strings: `openssl rand -hex 32`
- One token per external client (Claude Code, Claude Desktop, openclaw)
- Each agent container accepts the same set of client tokens (one token = access to all agents)
- Revoke a client: remove their token from `MCP_AUTH_TOKEN` in `.env`, restart containers
- Tokens stored in `.env` file on the server (not in docker-compose.yml or code)

### What's Not In Scope

- Per-tool authorization (all tokens get full access to the agent's tools)
- Token rotation API (update env var and restart)
- Rate limiting (Traefik can add this later if needed)
- OAuth/OIDC (overkill for machine-to-machine)

---

## 2. Docker Deployment

### docker-compose.yml

Single compose file with one service per agent. All services use the same built image, differing only by environment variables.

```yaml
x-mcp-base: &mcp-base
  image: mcp-nextcloud:latest
  build: .
  restart: unless-stopped
  networks: [proxy, nextcloud-aio]

services:
  mcp-nc-assistant:
    <<: *mcp-base
    container_name: mcp-nc-assistant
    environment:
      - NEXTCLOUD_HOST=http://nextcloud-aio-apache:11000
      - NEXTCLOUD_USERNAME=ai-assistant
      - NEXTCLOUD_PASSWORD=${ASSISTANT_PASSWORD}
      - MCP_AUTH_TOKEN=${CLIENT_AUTH_TOKENS}
      - MCP_AUTH_BYPASS_PRIVATE=true
    volumes:
      - analytics-assistant:/app/data

  mcp-nc-marketing:
    <<: *mcp-base
    container_name: mcp-nc-marketing
    environment:
      - NEXTCLOUD_HOST=http://nextcloud-aio-apache:11000
      - NEXTCLOUD_USERNAME=ai-marketing
      - NEXTCLOUD_PASSWORD=${MARKETING_PASSWORD}
      - MCP_AUTH_TOKEN=${CLIENT_AUTH_TOKENS}
      - MCP_AUTH_BYPASS_PRIVATE=true
    volumes:
      - analytics-marketing:/app/data

  mcp-nc-finance:
    <<: *mcp-base
    container_name: mcp-nc-finance
    environment:
      - NEXTCLOUD_HOST=http://nextcloud-aio-apache:11000
      - NEXTCLOUD_USERNAME=ai-finance
      - NEXTCLOUD_PASSWORD=${FINANCE_PASSWORD}
      - MCP_AUTH_TOKEN=${CLIENT_AUTH_TOKENS}
      - MCP_AUTH_BYPASS_PRIVATE=true
    volumes:
      - analytics-finance:/app/data

volumes:
  analytics-assistant:
  analytics-marketing:
  analytics-finance:

networks:
  proxy:
    external: true
  nextcloud-aio:
    external: true
```

The YAML anchor (`x-mcp-base`) ensures the image is built once and reused across all services. Each agent gets its own named volume for analytics persistence.

### .env file

```bash
# Nextcloud account passwords (app passwords)
ASSISTANT_PASSWORD=<ai-assistant app password>
MARKETING_PASSWORD=<ai-marketing app password>
FINANCE_PASSWORD=<ai-finance app password>

# Bearer tokens for external clients (shared across all agents)
CLIENT_AUTH_TOKENS=<claude-code-token>,<claude-desktop-token>,<openclaw-token>
```

### Migration from existing single-container setup

- Stop and remove the existing `mcp-nextcloud` container.
- The old `docker-compose.yml` had `ports: ["127.0.0.1:8085:8080"]` and a `mcp-network` bridge — both are removed. No host port mapping needed; Traefik routes external traffic, Docker network routes internal traffic.
- `mcp-nc-assistant` replaces `mcp-nextcloud` with the same `ai-assistant` account and credentials.
- Update Open WebUI tool server URL from `http://mcp-nextcloud:8080/mcp` to `http://mcp-nc-assistant:8080/mcp`.
- The `proxy` and `nextcloud-aio` external Docker networks already exist on canspace.

---

## 3. Traefik Routing

### DNS

- Add A record: `mcp.canspace.ca` → server IP

### Dynamic Config

**`/opt/docker/traefik/config/mcp-nextcloud.yml`:**

```yaml
http:
  routers:
    mcp-assistant:
      rule: "Host(`mcp.canspace.ca`) && PathPrefix(`/assistant`)"
      service: mcp-nc-assistant
      entryPoints: [websecure]
      tls:
        certResolver: letsencrypt
      middlewares: [strip-assistant]

    mcp-marketing:
      rule: "Host(`mcp.canspace.ca`) && PathPrefix(`/marketing`)"
      service: mcp-nc-marketing
      entryPoints: [websecure]
      tls:
        certResolver: letsencrypt
      middlewares: [strip-marketing]

    mcp-finance:
      rule: "Host(`mcp.canspace.ca`) && PathPrefix(`/finance`)"
      service: mcp-nc-finance
      entryPoints: [websecure]
      tls:
        certResolver: letsencrypt
      middlewares: [strip-finance]

  middlewares:
    strip-assistant:
      stripPrefix:
        prefixes: ["/assistant"]
    strip-marketing:
      stripPrefix:
        prefixes: ["/marketing"]
    strip-finance:
      stripPrefix:
        prefixes: ["/finance"]

  services:
    mcp-nc-assistant:
      loadBalancer:
        servers:
          - url: "http://mcp-nc-assistant:8080"
    mcp-nc-marketing:
      loadBalancer:
        servers:
          - url: "http://mcp-nc-marketing:8080"
    mcp-nc-finance:
      loadBalancer:
        servers:
          - url: "http://mcp-nc-finance:8080"
```

### External URLs

| Agent | MCP Endpoint | Health | Analytics Dashboard |
|---|---|---|---|
| Assistant | `https://mcp.canspace.ca/assistant/mcp` | `.../assistant/health` | `.../assistant/analytics/dashboard` |
| Marketing | `https://mcp.canspace.ca/marketing/mcp` | `.../marketing/health` | `.../marketing/analytics/dashboard` |
| Finance | `https://mcp.canspace.ca/finance/mcp` | `.../finance/health` | `.../finance/analytics/dashboard` |

---

## 4. Nextcloud Account & Permissions

### Accounts

| Account | Password Type | Groups | Purpose |
|---|---|---|---|
| `ai-assistant` (exists) | App password | AI Agents | General-purpose agent |
| `ai-marketing` (new) | App password | AI Agents, Marketing | Marketing & sales agent |
| `ai-finance` (new) | App password | AI Agents, Finance | Finance agent |

### Group Folders

| Folder | Groups with Access | Purpose |
|---|---|---|
| AI Workspace (exists, ID 8) | AI Agents | Shared space visible to all agents and users |
| Marketing (new) | Marketing, AI Agents | Marketing-specific documents |
| Finance (new) | Finance, AI Agents | Finance-specific documents |

Group Folder permissions: read, write, share, delete for all groups with access.

### Deck Board Sharing

- All boards auto-share with `AI Agents` group (already implemented in `createBoard`).
- Department boards can additionally share with department groups via the existing `share_with_groups` parameter.

---

## 5. Client Configuration

### Claude Code (`~/.claude.json` or project config)

```json
{
  "mcpServers": {
    "nextcloud-assistant": {
      "type": "streamable-http",
      "url": "https://mcp.canspace.ca/assistant/mcp",
      "headers": {
        "Authorization": "Bearer <claude-code-token>"
      }
    },
    "nextcloud-marketing": {
      "type": "streamable-http",
      "url": "https://mcp.canspace.ca/marketing/mcp",
      "headers": {
        "Authorization": "Bearer <claude-code-token>"
      }
    }
  }
}
```

### Claude Desktop (`claude_desktop_config.json`)

Same format as Claude Code.

### Open WebUI

Register each agent as a separate MCP tool server in Admin Settings > External Tools:
- Name: `Nextcloud Assistant` / URL: `http://mcp-nc-assistant:8080/mcp` / Type: MCP
- Name: `Nextcloud Marketing` / URL: `http://mcp-nc-marketing:8080/mcp` / Type: MCP
- Name: `Nextcloud Finance` / URL: `http://mcp-nc-finance:8080/mcp` / Type: MCP

Create Models that pair a system prompt + knowledge + the correct tool server for each persona.

---

## 6. Code Changes Summary

### Modified Files

| File | Change | Estimate |
|---|---|---|
| `src/http-server.ts` | Bearer token auth middleware, trust proxy config, disable query-param credential override when auth enabled, auth on analytics endpoints, auth failure logging | ~30 lines |

### No Changes To

- `src/client/*` — all client code unchanged
- `src/server/*` — all handler code unchanged
- `src/tools/*` — all tool registrations unchanged
- `src/utils/client-manager.ts` — credentials still from env vars
- `src/models/*` — all type definitions unchanged
- `Dockerfile` — same build process

---

## 7. Adding a New Agent

To add a new agent persona (e.g., `ai-instructional`):

1. Create Nextcloud account `ai-instructional`, generate app password
2. Add to `AI Agents` group + any department groups
3. Add service block to `docker-compose.yml` (copy existing, change env vars)
4. Add router + middleware + service to Traefik config
5. Add password to `.env`
6. `docker compose up -d mcp-nc-instructional`
7. Register in Open WebUI as tool server, create Model

No code changes required. Estimated time: ~10 minutes.
