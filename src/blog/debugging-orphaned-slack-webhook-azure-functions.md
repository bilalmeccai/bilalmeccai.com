---
layout: post
title: "The Silent Webhook: Debugging an Orphaned Slack Integration in Azure Functions"
subtitle: "Azure Function logs said 'Succeeded' all week. Slack received nothing. Here's how I traced it back to a developer who had already left the company."
description: "How an orphaned Slack webhook silently broke production ticket notifications in an Azure Function — and the exact steps to diagnose and fix it fast."
date: 2026-07-03
tags:
  - posts
  - Azure
  - Slack
  - Debugging
  - DevOps
  - Azure Functions
category: "DevOps"
tldr: "A Slack incoming webhook was silently revoked by Slack when its creator's account was deactivated. The Azure Function code <strong>discarded the HTTP response entirely</strong> — so it always logged <code>Succeeded</code> while delivering nothing. Fix: create a new Slack app with a fresh webhook, test with <code>curl</code> on staging, update the Function App config in Azure Portal."
faq:
  - q: "Why did the Slack webhook stop working without any error in the logs?"
    a: "Slack silently revokes webhooks from orphaned apps when the original creator's account is deactivated. The Azure Function code discarded the HTTP response and always returned true regardless of what Slack replied — so no error was ever raised or logged."
  - q: "How can I test whether a Slack webhook URL is still valid?"
    a: "Use curl: curl -X POST -H 'Content-type: application/json' --data '{\"text\":\"test\"}' YOUR_WEBHOOK_URL. A live webhook returns ok. A dead one returns invalid_token or no_service with a non-200 status."
  - q: "What happens to Slack app webhooks when the developer who created them leaves?"
    a: "The Slack app becomes orphaned. Workspace admins can no longer manage it through normal OAuth flows. When the creator's account is deactivated, Slack may silently revoke any webhooks associated with that app — no notification is sent to your backend."
  - q: "How do I create a replacement Slack incoming webhook?"
    a: "Go to api.slack.com/apps, click Create New App from scratch, enable Incoming Webhooks under Features, click Add New Webhook to Workspace, select the target channel, and copy the generated URL."
  - q: "How do I avoid being blindsided by silent Slack webhook failures in the future?"
    a: "Check the HTTP response from Slack in your code — do not discard it. Log non-200 responses as errors and alert on them. Slack returns ok for success and a descriptive error string for failures. Treat anything that isn't ok as a delivery failure."
---

{% tldr %}{{ tldr }}{% endtldr %}

A client's ticket management system had been silently dropping every Slack notification for nearly a week. The Azure Function logs looked completely clean — `Status: Succeeded`, no exceptions, no warnings. But `#pmpos-tickets` was dead quiet. No messages. No errors anywhere.

This is the story of how I tracked it down.

---

## The System

The platform is a SaaS POS management product. When support tickets are raised through the system, an Azure Function picks them up from a Service Bus queue and posts a notification to a Slack channel so the team knows immediately.

The flow, simplified:
```
Ticket Created → Service Bus Queue → Azure Function → Slack Webhook → #pmpos-tickets
```

Everything downstream of the Function — the Service Bus, the ticket database, the email notifications — was working. Only Slack was silent.

---

## Step 1: Read the Code

The notification logic lived in a service class. The core method looked like this:

```csharp
public bool NotifySlack(string ticketData)
{
    string ApiCallUrl = _config["MasterTicketSystemWebhook"];

    if (string.IsNullOrEmpty(ApiCallUrl))
        return false;

    string SerializedData = JsonConvert.SerializeObject(new { text = ticketData });
    var res = RestService.CallAPI(ApiCallUrl, Method.Post, SerializedData, null);

    response = true;  // ← always true. res is never checked.
    return response;
}
```

There it is. `RestService.CallAPI` returns the HTTP response — but `res` is never read. The method returns `true` no matter what Slack replied. Slack could return `403 Forbidden`, `410 Gone`, `invalid_token` — doesn't matter. The Function logs `Succeeded` and moves on.

This is the bug that made the failure invisible. But it's not the root cause. The root cause is *why* Slack was rejecting the request in the first place.

---

## Step 2: Check the Config

The webhook URL was stored in `MasterTicketSystemWebhook` in the Azure Function App's Application Settings. I confirmed the current value — it pointed to a real-looking Slack webhook URL for the right workspace. Nothing obviously wrong.

But the webhook URL format tells you a lot:

```
https://hooks.slack.com/services/WORKSPACE_ID/APP_ID/TOKEN
```

The workspace ID in the config (`T8ZHD05HV`) matched the team's Slack workspace URL. So the webhook was pointing at the right place.

---

## Step 3: Check the Git History

The integration wasn't documented anywhere. I ran a `git log` on the config file and the service class that made the webhook call.

Found it. A developer — let's call him N — had committed the original Slack integration. His last commit on this codebase was January 2024. He had since left the company.

Commit message, January 2024:
```
feat: add slack integration for ticket notifications
```

Six days after that commit, another developer had authorized the Slack app in the workspace. The app was called `Paymaple-Tickets-Prod` and was connected to the `#pmpos-tickets` channel.

---

## Step 4: Check the Slack App

In Slack's web panel, under the workspace's App Management, the `Paymaple-Tickets-Prod` app showed:

```
2 Authorized members
N — Jan 31, 2024 (Posts to a private channel with an incoming webhook)
Paymaple-Tickets-Prod — Jan 31, 2024 (Can post messages to specific channels)
```

And then this note:
> *Authorization hasn't been set up for this app, so you won't be able to install it.*

That's the signal. The app exists. The authorization record is still there. But the app is **orphaned** — the developer who created it is gone, and with him, the OAuth ownership. No one can manage or reinstall it.

When Slack deactivated N's account, the webhook he created was quietly revoked. No error surfaced in Azure. No alert fired. The Function kept posting to a dead URL and logging success every time because it never checked whether Slack actually accepted the message.

---

## The Verify Test

Before touching anything, I tested the webhook URL directly:

```bash
curl -X POST -H 'Content-type: application/json' \
  --data '{"text":"webhook test"}' \
  https://hooks.slack.com/services/T8ZHD05HV/[dead-webhook-token]
```

Response:
```
no_service
```

HTTP 403. Dead webhook confirmed.

---

## The Fix

### 1. Create a fresh Slack app and webhook

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. **Create New App** → From scratch → name it, select your workspace
3. Under **Features** → **Incoming Webhooks** → toggle ON
4. Click **Add New Webhook to Workspace** → select `#pmpos-tickets` → Allow
5. Copy the new webhook URL

### 2. Test the new URL before touching production

```bash
curl -X POST -H 'Content-type: application/json' \
  --data '{"text":"New webhook test — staging"}' \
  https://hooks.slack.com/services/T8ZHD05HV/[new-webhook-token]
```

Expected response: `ok`

If you see `ok` and a message appears in the channel, the webhook is live.

### 3. Update staging first

Azure Portal → Function App (staging) → **Configuration** → **Application Settings** → find `MasterTicketSystemWebhook` → replace the old URL → **Save**.

Trigger a test ticket in staging. Watch the channel. Confirm the message arrives.

### 4. Update production

Once staging passes, repeat in the production Function App. The Function App restarts automatically on config save — no deployment required.

---

## What the Fix Does Not Address

The silent failure pattern in the code is still there. After replacing the webhook, the immediate problem is solved — but the next time a webhook fails (expired, channel deleted, workspace changes), you'll have the same invisible failure.

The `res` variable gets thrown away. At minimum:

```csharp
var res = RestService.CallAPI(ApiCallUrl, Method.Post, SerializedData, null);

// Check what Slack actually said
if (res?.Content != "ok")
{
    _logger.LogError("Slack webhook delivery failed. Response: {Content}", res?.Content);
    return false;
}

response = true;
return response;
```

Slack's webhook responses are simple: `ok` for success, a descriptive error string for anything else. Log it. Alert on it. Don't throw the response away.

---

## The Pattern

This is a category of bug I've seen in several systems: **silent success from ignored external calls**. The symptoms are always the same:

- Everything in your system looks healthy
- Logs show success
- The external system received nothing
- The failure has been happening for days without anyone noticing

The three conditions that combine to create this:
1. External service fails silently (no retry, no dead letter, no circuit breaker)
2. Code ignores the HTTP response from that service
3. No alerting on the external side either (Slack doesn't email you when a webhook starts failing)

When you're debugging a case like this, the fastest path is:
1. Find the exact outbound HTTP call in the code — read it, don't assume
2. Test the target URL directly with `curl` to isolate whether it's a code problem or an endpoint problem
3. Check git history to find out who built the integration and when — orphaned setups are common

---

## Timeline

| Date | Event |
|------|-------|
| January 2024 | N builds and commits the Slack integration |
| January 2024 | Slack app `Paymaple-Tickets-Prod` authorized, webhook connected to `#pmpos-tickets` |
| Mid-2024 to June 2026 | Notifications working — webhook valid |
| ~June 25, 2026 | Webhook silently revoked (account deactivation / Slack app cleanup) |
| July 2, 2026 | Issue reported — `#pmpos-tickets` had gone quiet |
| July 2, 2026 | Root cause identified, new webhook created, fix deployed to staging then production |

---

## Key Takeaways

**On infrastructure:**
- Slack webhooks are tied to the app owner's account. When that person leaves, the app can become unmanageable and the webhooks can be revoked without warning.
- Incoming Webhooks owned by your team (not an individual) are safer — create apps under a service account or a shared ownership model.

**On code:**
- Never discard the response from an external HTTP call. Check it, log it, alert on it.
- "Fire and forget" is a valid pattern — but only when you don't care about delivery confirmation. For notifications your team depends on, you need to care.

**On debugging:**
- Git history is underused as a debugging tool. Knowing *who* built something and *when* often tells you exactly what to look for.
- When logs say Succeeded but the outcome is wrong, the first question is: does the code actually check what "succeeded" means?

---

<details>
<summary><strong>FAQ</strong></summary>

**Why did the Slack webhook stop working without any errors in the logs?**

Slack silently revokes webhooks from orphaned apps when the app owner's account is deactivated. The Azure Function code discarded the HTTP response and always returned `true` regardless — so no error was ever raised or logged.

**How can I test whether a Slack webhook URL is still valid?**

```bash
curl -X POST -H 'Content-type: application/json' \
  --data '{"text":"test"}' \
  YOUR_WEBHOOK_URL
```

A live webhook returns `ok`. A dead one returns `invalid_token`, `no_service`, or another error string with a non-200 status code.

**What happens to Slack app webhooks when the developer who created them leaves?**

The app becomes orphaned. Workspace admins can no longer manage it through OAuth. When the creator's account is deactivated, Slack may silently revoke webhooks associated with that app — no notification goes to your system.

**How do I avoid this pattern in the future?**

Check the HTTP response in your code. Slack webhook responses are simple: `ok` means it worked, anything else means it didn't. Log non-`ok` responses as errors and alert on them. Also consider owning Slack apps under a shared service account rather than an individual developer's Slack identity.

</details>
