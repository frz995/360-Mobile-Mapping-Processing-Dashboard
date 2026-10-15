# GeoSphere 360 — Dedicated Client Database Setup Guide

This guide describes how to provision, configure, and connect a **Dedicated Client Database** (`dedicated_external`) for enterprise clients in the **Seller Partner Console** (`https://app.geosphere.my/console`).

---

## 1. Core Principles & Requirements

### 1.1 The HTTPS Requirement (No `http://localhost` in Production)
The production platform is hosted on **`https://app.geosphere.my`**.
Modern web browsers enforce strict **Mixed-Content Security Policies**: any request (`fetch`, WebSocket, REST) from an HTTPS origin to an insecure HTTP origin (`http://`) is blocked by the browser.

* ❌ **Never enter `http://localhost` or `http://127.0.0.1` into the production console.** Localhost points to the visitor's personal laptop, not the client's database.
* ✅ **Every client database URL must start with `https://`** and possess a valid, trusted SSL certificate (e.g. Let's Encrypt or Cloudflare).

### 1.2 Use the `anon` Key (Never `service_role`)
* ✅ **Client Anon Key (`anon`):** Designed for client web browsers and applications. Enforces **Row-Level Security (RLS)** so users can only access their authorized records.
* ❌ **Service Role Key (`service_role`):** Bypasses all Row-Level Security and grants complete superuser admin privileges over every table. Exposing this key to client browsers creates severe security exposure.

---

## 2. Decision Tree: Choosing the Right Routing

```
                         Does the client need a dedicated database?
                                           │
                    ┌──────────────────────┴──────────────────────┐
                    ▼                                             ▼
                   NO                                            YES
         ┌─────────────────────┐                    ┌────────────────────────────┐
         │  Cloud Shared (RLS) │                    │ Does the client require    │
         │  (Standard SaaS)    │                    │ physical on-premises data? │
         └─────────────────────┘                    └─────────────┬──────────────┘
                                                                  │
                                           ┌──────────────────────┴──────────────────────┐
                                           ▼                                             ▼
                                          NO                                            YES
                              ┌─────────────────────────┐                   ┌───────────────────────────┐
                              │ Option A: Supabase Cloud│                   │ Option B: Physical Server │
                              │ (Seller-Managed Cloud)  │                   │ (Client LAN + Cloudflare) │
                              └─────────────────────────┘                   └───────────────────────────┘
```

---

## 3. Path A: Standard SaaS Client (`cloud_shared`)

For 95% of clients who do not have explicit physical hardware compliance requirements:

1. In **Seller Console → Client Companies**, select:
   * **Database Routing:** 🔘 **Cloud Shared (RLS)**
2. **Zero database setup required.** The platform automatically isolates the client's projects, staging runs, defects, and panoramas using Row-Level Security on the primary cluster (`organization_id`).

---

## 4. Path B: Seller-Managed Dedicated Supabase Cloud (Fastest & Zero DevOps)

When an enterprise client pays for a dedicated, isolated database, but you (the seller) manage everything without touching Linux servers:

### Step 1: Create the Project on Supabase Cloud
1. Log into your company account at [supabase.com](https://supabase.com).
2. Click **New Project**:
   * **Name:** `geosphere-[clientcode]` (e.g. `geosphere-tnb`)
   * **Region:** `Singapore (ap-southeast-1)` (or closest region)
   * **Pricing Plan:** Pro ($25/month — billed back to client)
3. Save the database password securely.

### Step 2: Push GeoSphere Database Migrations
Open your local terminal and push the platform schema to the new project:
```bash
npx supabase db push --db-url "postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres"
```

### Step 3: Copy Credentials to the Seller Console
1. In Supabase Dashboard, open **Project Settings → API**.
2. Copy:
   * **Project URL:** `https://[PROJECT_REF].supabase.co`
   * **Project API Keys → `anon public`:** `eyJhbGciOi...`
3. In `https://app.geosphere.my/console`:
   * Select **Dedicated Client DB**.
   * Paste the **Client Supabase URL** and **Client Anon Key**.
   * Click **Test Connection** → Displays **✓ Connection verified (HTTP 200 OK)**.
   * Save the company.

---

## 5. Path C: True On-Premises Physical Server (Client LAN with Cloudflare Tunnel)

When a client strictly forbids cloud databases (e.g. government, utilities like TNB) and requires physical hardware inside their building:

```
  CLIENT'S PRIVATE OFFICE / LAN
┌────────────────────────────────────────────────────────┐
│  Physical Mini-PC / Server (Ubuntu Linux)              │
│                                                        │
│  1. Runs Docker Supabase on 127.0.0.1:8000             │
│  2. Runs Cloudflare Tunnel (cloudflared daemon)        │
└───────────────────────────┬────────────────────────────┘
                            │ Outbound encrypted tunnel
                            │ (No router ports opened!)
                            ▼
              [ Cloudflare Edge (Valid SSL) ]
                            │
                            ▼
              https://[client].db.geosphere.my
                            │
                            ▼
              [ app.geosphere.my/console ]
```

### Step 1: Install Docker Supabase on the On-Premises Machine
On the client's local server (or mini-PC):
```bash
# 1. Install Docker
curl -fsSL https://get.docker.com | sh

# 2. Clone official Supabase Docker repository
git clone --depth 1 https://github.com/supabase/supabase
cd supabase/docker
cp .env.example .env

# 3. Configure .env with secure passwords and set:
# API_EXTERNAL_URL=https://[client].db.geosphere.my

# 4. Start Supabase containers
docker compose pull
docker compose up -d
```

### Step 2: Expose via Cloudflare Tunnel (Zero Open Ports)
Enterprise corporate firewalls will not allow incoming port forwarding. **Cloudflare Tunnel (`cloudflared`)** creates an outbound-only encrypted tunnel with automatic SSL:

1. In your Cloudflare Dashboard under `geosphere.my`:
   * Go to **Zero Trust → Networks → Tunnels → Add a Tunnel**.
   * Choose **Cloudflared** and name it (e.g. `tnb-onprem`).
2. Run the connector command on the on-premise server:
   ```bash
   sudo cloudflared service install <CLOUDFLARE_TUNNEL_TOKEN>
   ```
3. In the Cloudflare Tunnel Public Hostname configuration:
   * **Subdomain:** `[client].db` (e.g. `tnb.db.geosphere.my`)
   * **Type:** `HTTP`
   * **URL:** `localhost:8000`

### Step 3: Push Database Migrations
From your workstation or the on-premise server:
```bash
npx supabase db push --db-url "postgresql://postgres:[PASSWORD]@127.0.0.1:5432/postgres"
```

### Step 4: Register in Seller Console
1. Open `https://app.geosphere.my/console`.
2. Select **Dedicated Client DB**.
3. **Client Supabase URL:** `https://[client].db.geosphere.my`
4. **Client Anon Key:** The `ANON_KEY` from the on-premise `.env`.
5. Click **Test Connection** → Displays **✓ Connection verified (HTTP 200 OK)**.
6. Click **Save Company**.

---

## 6. Temporary Local Testing with Cloudflare Quick Tunnels

If you are developing locally and want to test reaching your laptop's local Docker Supabase (`http://127.0.0.1:8000`) directly from live production (`app.geosphere.my/console`), start a temporary quick tunnel:

```powershell
# 1. Launch quick tunnel
cloudflared tunnel --url http://127.0.0.1:8000

# 2. Copy the generated URL
# Example: https://random-words.trycloudflare.com

# 3. Paste into app.geosphere.my/console with your local VITE_SUPABASE_ANON_KEY
```

---

## 7. Operator Troubleshooting Checklist

| Error in Console | Cause | Solution |
| :--- | :--- | :--- |
| **Server replied with HTTP 403** | Envoy gateway RBAC blocks anon keys on `/rest/v1/` root OpenAPI. | Update app build (our probe checks `/auth/v1/health` first) or verify the API key is correct. |
| **Server replied with HTTP 401** | The `anon` key is incorrect, truncated, or has a mismatched JWT secret. | Re-copy the `anon public` key from Supabase API settings. |
| **Failed to fetch / Network Error** | The URL uses `http://` instead of `https://`, causing browser Mixed Content blocks. | Ensure the URL begins with `https://` and has a valid SSL certificate. |
| **CORS Error in Browser DevTools** | The external server's reverse proxy does not permit requests from `https://app.geosphere.my`. | Ensure Envoy/Caddy/Nginx returns `Access-Control-Allow-Origin: https://app.geosphere.my` or `*`. |
| **Connection timed out after 8s** | The domain is not resolving, or the server/tunnel is offline. | Verify the server is running and the tunnel is connected. |
