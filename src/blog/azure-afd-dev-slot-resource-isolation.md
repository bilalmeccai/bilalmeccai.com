---
layout: post
title: "Your Staging Environment Is Probably Talking to Prod Right Now"
subtitle: "How I found 4 cross-environment resource leaks in an Azure Front Door staging setup — and the systematic audit that caught them."
description: "Azure dev slots silently sharing prod databases, Redis, and storage is more common than you think. Here's how to audit, map, and fix resource isolation violations with Azure CLI."
date: 2026-06-28
tags:
  - posts
  - Azure
  - DevOps
  - Azure Front Door
  - Staging
  - Infrastructure
category: "DevOps Engineering"
tldr: "Dev slots on Azure App Service will inherit production app settings unless you <strong>explicitly override every resource connection</strong> — DB, Redis, storage, and cert check. Running <code>az webapp config appsettings list</code> across all slots in one pass will reveal which ones are silently hitting prod resources. We found 4 violations in a single audit pass."
faq:
  - q: "Why would a dev slot point to a production database?"
    a: "Azure App Service slot settings are not isolated by default. If you create a new deployment slot and don't explicitly configure its connection strings and app settings, it inherits or falls back to the main slot's values. Developers often miss this because the slot starts up and appears healthy — there's no warning that it's writing to prod data."
  - q: "What does enforceCertificateNameCheck do in Azure Front Door?"
    a: "When set to true (the default), Azure Front Door validates that the SSL certificate on the backend origin matches the origin's hostname. For dev slots on azurewebsites.net, this causes a 502 when the custom AFD domain doesn't match. Set it to false for staging origins where the hostname mismatch is intentional."
  - q: "How do I audit all dev slot app settings across multiple Azure web apps?"
    a: "Use az webapp config appsettings list --resource-group <rg> --name <app> --slot <slot-name>. Run this against each slot. Pipe to jq to extract specific keys like DB connection strings or IsMultiTenant flags. Compare against your expected dev/staging resource names."
  - q: "What is a cross-environment bleed violation?"
    a: "When a non-production environment (dev slot, staging slot) is configured to connect to a production resource — database, cache, blob storage, or external service. The risk: dev testing writes real data, corrupts prod state, or exposes prod credentials to less-secured environments."
  - q: "Should I use sticky slot settings in Azure for connection strings?"
    a: "Yes. Mark environment-specific app settings and connection strings as 'slot settings' (deployment slot settings) in Azure. This ensures they don't swap when you do a slot swap — prod keeps its prod connection strings, staging keeps its staging ones."
---

## The Setup

We were standing up Azure Front Door (AFD) as the CDN and routing layer for a payment platform's staging environment. The goal: route traffic through a custom staging domain to the correct Azure App Service deployment slots, without touching the production setup.

Simple enough on paper. In practice: three months of incremental work had produced three separate documentation files, all slightly out of date, none fully consistent with what was actually deployed. Classic.

The first task was to consolidate everything. Not just rewrite the docs — verify every value against live Azure, then write from truth.

The second task is what this post is about.

---

## The Question That Exposed Everything

Once the masterbook was done, I asked a simple question: **are the dev slots actually isolated from production resources?**

Not "do they have the right URL?" Not "do they respond to requests?" — but are they talking to dev databases, dev Redis, dev storage? Or are they silently running queries against production?

This is a question most engineers skip because the slots work. Requests come back 200. Nobody complains. The problem only surfaces when a developer's test run corrupts a prod record, or when you're debugging a staging issue and realize the "test" data is actually live customer data.

Let me show you what we found.

---

## Step 1: Query Live Slot Settings

The audit is simple. Run `az webapp config appsettings list` against every dev slot. For a payment platform with multiple services, that means something like:

```bash
# Query all app settings for a specific dev slot
az webapp config appsettings list \
  --resource-group your-resource-group \
  --name your-app-name \
  --slot dev \
  --output table
```

Do this for every service — API, OBA (online banking), POS, control panel, tickets, webhook handler. Every one of them.

The output shows every app setting key and value. What you're looking for is resource connection strings:

| Setting Key | What it connects to |
|---|---|
| `ConnectionStrings__DefaultConnection` | Database |
| `Redis__ConnectionString` | Redis cache |
| `StorageAccount__ConnectionString` | Blob storage |
| `KeyVault__Vault` | Key Vault (prod or dev?) |
| `IsMultiTenant` | Tenant routing mode |
| `AllowSpecificOrigin` | CORS allowed origin |

Now compare: does the value look like your dev/staging resource? Or your production one?

---

## What We Found: 4 Violations

After running the audit across 8 dev slots, we had a clean map. Here's a sanitised version of what the violations looked like:

| Service | Resource | Issue |
|---|---|---|
| Tickets API dev slot | Redis | Connection string pointed to **production** Redis instance |
| API dev slot | Blob storage | Storage account URL was the **production** storage account |
| OBA dev slot | CORS origin | `AllowSpecificOrigin` still set to **production** azurewebsites URL |
| OBA dev slot | Config | `IsMultiTenant` and `AllowSpecificOrigin` not configured at all |

The last one is the silent killer. When a setting is missing entirely, Azure App Service either errors on startup, falls back to a default, or — worst case — resolves it from a linked Key Vault that points to prod values.

---

## The Azure Front Door Cert Check Problem

Before we even got to resource isolation, we hit a different wall: **502s on every request through AFD**.

The error comes from a setting called `enforceCertificateNameCheck` on AFD origins. When it's `true` (the default), AFD validates that the SSL certificate on the backend matches the origin's hostname.

For production this is fine — your app is at `api.yourdomain.com` and the cert says `api.yourdomain.com`. Match.

For staging dev slots, you're routing `staging.yourdomain.com` (or the AFD staging endpoint) through to `your-app-dev.azurewebsites.net`. The cert on that origin says `*.azurewebsites.net`, not your custom domain. AFD rejects the connection.

The fix is one command per origin:

```bash
az afd origin update \
  --resource-group your-rg \
  --profile-name your-afd-profile \
  --origin-group-name og-apidev \
  --origin-name your-api-dev-origin \
  --enforce-certificate-name-check false
```

Run this for every dev slot origin. Do not confuse this with disabling cert validation entirely — you're only telling AFD not to do hostname matching on the backend connection. TLS is still in use.

We verified the fix worked by checking the origin config after:

```bash
az afd origin show \
  --resource-group your-rg \
  --profile-name your-afd-profile \
  --origin-group-name og-apidev \
  --origin-name your-api-dev-origin \
  --query enforceCertificateNameCheck
```

Expected output: `false`

---

## Step 2: Map the Full Resource Picture

Once we had all slot settings, we built a resource isolation map. One row per service slot, columns for each resource type. Something like this:

| Slot | Database | Redis | Storage | Cert Check | Issues |
|---|---|---|---|---|---|
| api-dev | dev DB ✅ | dev Redis ✅ | **prod storage** ❌ | false ✅ | Storage bleed |
| oba-dev | dev DB ✅ | dev Redis ✅ | dev storage ✅ | **true** ❌ | Cert check 502 |
| tickets-dev | dev DB ✅ | **prod Redis** ❌ | dev storage ✅ | false ✅ | Redis bleed |
| pos-dev | dev DB ✅ | dev Redis ✅ | dev storage ✅ | false ✅ | IsMultiTenant=false |

Two things jump out of this map:
1. **No single slot has all violations.** They're scattered. You'd never find this without querying all slots.
2. **Some violations are subtle.** `IsMultiTenant=false` on the POS dev slot means it won't correctly resolve tenant-scoped database connections. The slot starts up fine, returns 200s — but certain operations silently use the wrong tenant context.

---

## The Fix Protocol

For each violation, the remediation follows the same pattern:

**1. Resource connection fixes** — update the specific app setting to point at the dev resource:

```bash
az webapp config appsettings set \
  --resource-group your-rg \
  --name your-app \
  --slot dev \
  --settings "Redis__ConnectionString=your-dev-redis.redis.cache.windows.net:6380,password=..."
```

**2. Mark settings as slot-sticky** so they don't get wiped on a slot swap:

```bash
az webapp config appsettings set \
  --resource-group your-rg \
  --name your-app \
  --slot dev \
  --slot-settings "Redis__ConnectionString" "ConnectionStrings__DefaultConnection"
```

The `--slot-settings` flag is the key one most teams miss. Without it, your carefully configured dev settings will be overwritten next time someone does a production slot swap.

**3. Verify after every fix** — don't trust the command succeeding, query the live value:

```bash
az webapp config appsettings list \
  --resource-group your-rg \
  --name your-app \
  --slot dev \
  --query "[?name=='Redis__ConnectionString'].value" \
  --output tsv
```

---

## The Documentation Trap

Here's the meta-lesson from this whole exercise.

Before the audit, we had documentation. Three files, totalling probably 1,500 lines. They listed slot names, hostnames, connection strings — the works. Written during the initial setup, updated occasionally when someone remembered.

When we queried live Azure, the docs were wrong in at least four places:
- Two slot hostnames were different from what was documented (named slots have different URL patterns than expected)
- Two cert check settings showed the Phase 0 fix had already been applied (docs hadn't caught up)
- One slot had settings that had never been documented at all

This isn't a documentation quality problem. It's a fundamental limitation of documentation as a source of truth for infrastructure state. **The only reliable source of truth is the live infrastructure itself.**

The new rule: before any staging work, run a full settings audit. Script it if you're doing this regularly. Make the query the first step, not the docs.

---

## Quick Audit Script

Here's the pattern for auditing multiple slots across multiple apps in one pass:

```bash
#!/bin/bash
RG="your-resource-group"
APPS=("app-api" "app-oba" "app-pos" "app-tickets")
SLOTS=("dev" "staging")

for APP in "${APPS[@]}"; do
  for SLOT in "${SLOTS[@]}"; do
    echo "=== $APP / $SLOT ==="
    az webapp config appsettings list \
      --resource-group "$RG" \
      --name "$APP" \
      --slot "$SLOT" \
      --query "[?contains(name, 'Connection') || contains(name, 'Redis') || contains(name, 'Storage') || name=='IsMultiTenant'].{Key:name, Value:value}" \
      --output table 2>/dev/null || echo "(slot not found)"
    echo ""
  done
done
```

Run this before and after any staging environment changes. The diff tells you exactly what changed and surfaces any accidental production connections.

---

## Checklist

Before calling a staging environment "ready":

- [ ] All dev slots have `enforceCertificateNameCheck=false` on their AFD origins
- [ ] All connection strings point at dev/staging resources (not prod)
- [ ] Redis connection strings verified — dev Redis, not prod
- [ ] Storage account URLs verified — dev storage, not prod
- [ ] Key Vault references point at a staging vault with staging secrets
- [ ] CORS `AllowSpecificOrigin` updated to the staging domain
- [ ] `IsMultiTenant` configured correctly for multi-tenant services
- [ ] All environment-specific settings marked as slot-sticky
- [ ] OAuth redirect URIs registered for staging domains
- [ ] Full smoke test run: auth flow, data write, external service call

<details>
<summary><strong>FAQ</strong></summary>

**Why would a dev slot point to a production database?**
Azure App Service slots don't isolate app settings by default. Create a new slot and it inherits or falls back to the parent app's values unless you explicitly override each one. The slot starts up and responds to requests — there's no warning that it's writing to prod.

**What does `enforceCertificateNameCheck` do in Azure Front Door?**
It validates that the SSL cert on the backend matches the origin hostname. For staging dev slots, the cert is `*.azurewebsites.net` but AFD is routing a custom domain — that mismatch causes a 502. Setting it to `false` for staging origins fixes this without disabling TLS.

**How do I find all dev slot hostnames accurately?**
Don't trust documentation. Run `az webapp deployment slot list --resource-group <rg> --name <app>` to get the actual slot names, then `az webapp show` on each slot for the confirmed `defaultHostName`. Slot naming varies depending on how the slot was created.

**What are slot-sticky settings and why do they matter?**
Slot settings (marked with `--slot-settings`) stay with the slot when you do a slot swap. Without this, doing a swap to promote staging to production would overwrite your production database credentials with staging ones — or vice versa. Always mark environment-specific connection strings as slot-sticky.

</details>
