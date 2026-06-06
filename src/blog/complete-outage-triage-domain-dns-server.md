---
layout: post
title: "A Developer Spent 2 Hours on a Downed Site. I Fixed It in 30 Minutes."
subtitle: "Domain expired. Server unresponsive. DNS not resolving. Three separate failure points hit simultaneously — here's the exact diagnostic sequence that brought everything back."
description: "When a client's CRM-ERP system went down overnight — expired domain, unresponsive Hetzner server, broken DNS — most engineers chase one problem at a time. Here's how to triage all three in 30 minutes."
date: 2026-06-06
tags:
  - posts
  - DNS
  - DevOps
  - Debugging
  - Hetzner
  - Cloudflare
category: "Infrastructure & DevOps"
tldr: "A downed site is rarely one problem. This one had three: <strong>expired domain</strong>, <strong>unresponsive Hetzner server</strong>, and <strong>stale Cloudflare DNS cache</strong>. The fix wasn't complex — the speed came from knowing which layer to check first, and checking all three in parallel instead of one at a time."
faq:
  - q: "What should I check first when a website goes completely down?"
    a: "Check in this order: (1) Domain validity — has it expired? Run a WHOIS lookup. (2) DNS resolution — do A records point anywhere? Use dig or nslookup. (3) Server reachability — can you ping the IP directly? (4) Server power state — is the VM actually running? These four checks take under 5 minutes and cover 90% of total outage scenarios."
  - q: "How do I check if a domain has expired?"
    a: "Run a WHOIS lookup: whois yourdomain.com in terminal, or use lookup.icann.org. An expired domain will show 'Expired' or a past expiry date in the Registry Expiry Date field. Renew immediately through your registrar — propagation takes 15–60 minutes after renewal."
  - q: "How do I clear Cloudflare DNS cache after a domain renewal or server change?"
    a: "Go to Cloudflare Dashboard → your domain → Caching → Configuration → Purge Cache → Purge Everything. For DNS-specific propagation, also check the DNS tab and confirm your A records point to the correct IP. Cloudflare's edge cache can hold stale records for minutes to hours without a manual purge."
  - q: "What does it mean when a Hetzner server is unresponsive to ping?"
    a: "An unresponsive Hetzner server (no ping response, SSH timeout) usually means the VM has crashed, frozen, or powered off. Log into the Hetzner Cloud Console or Robot panel, check the server status, and use the Power Cycle or Reset option. If the console shows a kernel panic or frozen boot screen, a hard reset or rescue mode may be needed."
  - q: "Why does my site go down even though my server is running fine?"
    a: "If your server is running but the site is down, the problem is almost always at the DNS layer — A records pointing to a wrong or old IP, expired domain breaking resolution, or a stale CDN cache serving dead records. Check DNS resolution separately from server health using dig +short yourdomain.com."
---

## The 2am Message

A client's CRM-ERP system was completely down. Their developer had been working the problem for two hours — restarting services, checking application logs, escalating internally.

Nothing was working.

I got pulled in. Thirty minutes later, every site was back online.

Here's the exact sequence of what happened — and more importantly, **why the developer was stuck** while I wasn't.

---

## What Was Actually Broken

Three separate failure points. All hitting simultaneously.

| Layer | Problem | Symptom |
|---|---|---|
| Domain | Expired overnight | NXDOMAIN on all DNS lookups |
| Server | Hetzner VM unresponsive | No ping, SSH timeout |
| DNS | Cloudflare cache stale | A records not traversing after renewal |

The developer was debugging the **application layer** — wrong floor entirely.

---

## Why Most Engineers Get Stuck Here

When a site goes down, the instinct is to check what you own: application logs, service restarts, config files. That's where you've been working. That's where you look.

But a **complete outage** — where nothing resolves, nothing responds — is almost never an application problem. It's infrastructure. Specifically, it's one of four things:

1. Domain validity
2. DNS resolution
3. Network / server reachability
4. Server power state

Check these first. Every time. Before you touch a single application log.

{% callout "tip" %}
**The 5-minute rule:** Before opening any application log during a complete outage, spend 5 minutes at the infrastructure layer. Domain, DNS, ping, server console. If any of these fail, you've found your problem. Application logs can wait.
{% endcallout %}

---

## The Diagnostic Sequence — Step by Step

### Step 1 — Domain validity check (2 minutes)

First thing I ran:

```bash
whois clientdomain.com | grep -i "expir"
```

Output showed the domain had expired the previous day. That's your NXDOMAIN. That's why DNS lookups were returning nothing — the domain didn't exist as far as the internet was concerned.

**Fix:** Renewed the domain immediately through the registrar. Propagation begins within minutes but can take up to an hour.

{% callout "warn" %}
**Don't wait for propagation before doing the next steps.** Renewal takes minutes to initiate. While it propagates, diagnose everything else in parallel.
{% endcallout %}

### Step 2 — Server reachability check (2 minutes)

While the domain renewal processed, I checked the server directly by IP — bypassing DNS entirely:

```bash
ping 65.XXX.XXX.XXX        # direct IP ping
ssh root@65.XXX.XXX.XXX    # SSH attempt
```

No ping response. SSH timed out. This is a separate problem from the domain.

The server itself was unresponsive — not a network routing issue, not a firewall block. The VM had frozen or crashed.

**Fix:** Contacted the team to initiate a manual power cycle via the Hetzner Cloud Console. A hard reset brought the server back up within 3 minutes.

### Step 3 — DNS cache purge on Cloudflare (3 minutes)

Once the domain renewed and the server was back online, DNS still wasn't resolving correctly. A records weren't traversing.

The domain renewal had updated registry records — but Cloudflare was still serving cached records that predated the renewal. The stale cache was blocking resolution even though the underlying records were now correct.

**Fix:** Cloudflare Dashboard → Caching → Configuration → **Purge Everything**.

```bash
# Verify resolution after purge
dig +short clientdomain.com
dig +short www.clientdomain.com

# Should return the server IP — not empty, not an old IP
```

---

## The Full Fix Timeline

```
00:00 — Called in. Developer has been working for 2 hours.
00:02 — WHOIS check. Domain expired. Renewal initiated.
00:04 — Direct IP ping. Server unresponsive. Power cycle requested.
00:07 — Server back online after hard reset.
00:10 — DNS still not resolving. Cloudflare cache identified as blocker.
00:12 — Cloudflare cache purged.
00:15 — A records traversing. Sites resolving.
00:30 — All services confirmed live. CRM-ERP operational.
```

Developer had been debugging the wrong layer for 120 minutes.
I fixed the right layers in 30.

---

## The Mental Model That Makes This Fast

Think of a website as a stack of layers. When everything is down, **start at the bottom**:

```
Layer 5 — Application (code, services, databases)
Layer 4 — Web server (nginx, apache, config)
Layer 3 — Server OS (processes, memory, disk)
Layer 2 — Server power (is the VM actually running?)
Layer 1 — Network / DNS (can anyone reach it at all?)
Layer 0 — Domain (does the domain legally exist?)
              ↑
         Start here
```

A complete outage means **someone at the bottom of this stack failed.** Work upward. Don't start at Layer 5 and dig down — you'll spend hours in the wrong place.

> "Pattern recognition isn't about being smarter. It's about knowing which layer to check first — and checking all of them in parallel instead of one at a time."

---

## Checklist — Complete Outage Triage

Use this the next time a site goes fully dark:

1. **Domain check** — `whois domain.com | grep -i expir` — is it valid?
2. **DNS resolution** — `dig +short domain.com` — do A records return an IP?
3. **Direct ping** — `ping <server-ip>` — is the server reachable by IP?
4. **SSH attempt** — `ssh root@<server-ip>` — does the server accept connections?
5. **Server console** — check your hosting panel (Hetzner, AWS, Azure) — is the VM running?
6. **CDN cache** — if using Cloudflare or similar, purge after any DNS/domain change

If you can clear all six in under 10 minutes, you'll resolve 90% of complete outages before most engineers have finished reading the first error log.

---

## What This Proves

The developer wasn't bad at their job. They were debugging their layer — the application. That's what they know.

The difference is knowing **the full stack**, not just your slice of it. Domain registrars, server infrastructure, DNS propagation, CDN cache invalidation — these live outside the application. But they're the first thing to check when the application is unreachable.

That's the difference between 2 hours and 30 minutes.

---

If you're dealing with a downed system right now and the checklist above isn't resolving it, feel free to reach out. Sometimes a second pair of eyes on the layer stack is all it takes. [bilalmeccai.com/#contact](https://bilalmeccai.com/#contact) or bilalmeccai@gmail.com.

---

## Frequently Asked Questions

<details class="faq-item">
  <summary class="faq-q">What should I check first when a website goes completely down?</summary>
  <div class="faq-a">Check in this order: (1) Domain validity — run a WHOIS lookup. (2) DNS resolution — use <code>dig +short yourdomain.com</code>. (3) Server reachability — ping the IP directly. (4) Server power state — check your hosting panel. These four checks take under 5 minutes and cover 90% of complete outage scenarios.</div>
</details>

<details class="faq-item">
  <summary class="faq-q">How do I check if a domain has expired?</summary>
  <div class="faq-a">Run <code>whois yourdomain.com</code> in terminal or use lookup.icann.org. An expired domain shows a past date in the Registry Expiry Date field. Renew immediately — propagation takes 15–60 minutes.</div>
</details>

<details class="faq-item">
  <summary class="faq-q">How do I clear Cloudflare DNS cache after a domain renewal?</summary>
  <div class="faq-a">Cloudflare Dashboard → your domain → Caching → Configuration → Purge Cache → Purge Everything. Then verify with <code>dig +short yourdomain.com</code> — it should return your server IP within minutes.</div>
</details>

<details class="faq-item">
  <summary class="faq-q">What does it mean when a Hetzner server is unresponsive to ping?</summary>
  <div class="faq-a">The VM has likely crashed, frozen, or powered off. Log into the Hetzner Cloud Console, check the server status, and use the Power Cycle or Reset option. If you see a frozen boot screen in the console, a hard reset or rescue mode will be needed.</div>
</details>

<details class="faq-item">
  <summary class="faq-q">Why is my site down even though the server is running fine?</summary>
  <div class="faq-a">If the server is running but the site is unreachable, the problem is almost always at the DNS layer — expired domain, stale CDN cache, or A records pointing to an old IP. Check DNS resolution separately from server health using <code>dig +short yourdomain.com</code>.</div>
</details>
