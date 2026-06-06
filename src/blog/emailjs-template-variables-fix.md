---
layout: post
title: "Why Your EmailJS Template Variables Aren't Showing Up — And the 60-Second Fix"
subtitle: "You set up your contact form, wired in EmailJS, hit send — and the email arrives with blank fields where {{name}} and {{message}} should be. Here's exactly what's happening and how to fix it."
description: "EmailJS variables like {{name}}, {{message}}, {{topic}} not showing in emails? The variable names in your JS payload must exactly match your template placeholders. Here's the fix."
date: 2026-06-06
tags:
  - posts
  - EmailJS
  - JavaScript
  - Debugging
category: "Web Engineering"
tldr: "Your <code>emailjs.send()</code> payload keys must <strong>exactly match</strong> the <code>{{placeholder}}</code> names in your template — same spelling, same case, no exceptions. If your template says <code>{{name}}</code> and your JS sends <code>from_email</code>, that field renders blank. Map every variable explicitly."
faq:
  - q: "Why are my EmailJS template variables showing as blank?"
    a: "The variable names in your emailjs.send() payload object don't match the {{placeholder}} names in your template. EmailJS requires an exact character-for-character match. Check spelling and casing of every variable on both sides."
  - q: "Does EmailJS variable matching work case-sensitively?"
    a: "Yes. {{Name}} and {{name}} are treated as different variables. Always use lowercase consistently across your template and JS payload."
  - q: "How do I set up Reply To in EmailJS so I can respond directly?"
    a: "In your EmailJS template editor, set the Reply To field to {{email}}. Then include email: userEmailAddress in your JS payload. When you hit reply in Gmail, it goes directly to the visitor."
  - q: "How do I add an IST timestamp to EmailJS emails?"
    a: "Pass a time key in your payload: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }). Add {{time}} in your template where you want it rendered."
  - q: "EmailJS send returns 200 but I'm not receiving emails — why?"
    a: "Check: (1) Your Gmail service is connected in EmailJS Email Services. (2) Check your spam folder. (3) Check EmailJS Email History for the exact status and error codes."
---

## The Problem

You've built a contact form. You integrated EmailJS — free, no backend, works directly from the browser. Your template looks clean. Your JavaScript looks right. You test it.

The email arrives — but every `{{variable}}` field is blank.

{% callout "warn" %}
**EmailJS does not throw an error when variable names don't match.** The send call succeeds with status 200 — but the template renders empty fields silently. This is why it's easy to miss.
{% endcallout %}

## Why It Happens

EmailJS templates use `{{variable_name}}` placeholders. When you call `emailjs.send()`, the third argument is a plain JavaScript object. EmailJS matches the **object keys** to the **template placeholder names** — character for character, case sensitive.

Any mismatch — different name, extra underscores, different casing — and that variable renders empty. No warning. No error. Just blank.

Here's the exact mismatch pattern:

```js
// Template uses: {{name}}, {{email}}, {{message}}, {{topic}}, {{time}}

// ❌ WRONG — keys don't match template placeholders
emailjs.send(SERVICE_ID, TEMPLATE_ID, {
  from_email: email,   // template expects {{name}}, not {{from_email}}
  topic:      topic,   // ✓ matches
  message:    message, // ✓ matches
  reply_to:   email,   // not a template variable
});
```

The template expects `{{name}}` and `{{email}}` — the payload sends `from_email` and `reply_to`. EmailJS finds no match, renders blank.

## The Fix

Every key in your `emailjs.send()` payload must exactly match a `{{placeholder}}` in your template. Go to your template, list every variable used, mirror them in your JS object.

```js
// ✅ CORRECT — every key matches a template placeholder
await emailjs.send(SERVICE_ID, TEMPLATE_ID, {
  name:    email,          // → {{name}}
  email:   email,          // → {{email}}  (used in Reply To)
  topic:   topic,          // → {{topic}}
  message: message || '(No message provided)', // → {{message}}
  time:    new Date().toLocaleString('en-IN', {
             timeZone:  'Asia/Kolkata',
             dateStyle: 'medium',
             timeStyle: 'short'
           }),             // → {{time}}  IST timestamp
});
```

{% callout "ok" %}
After this fix, every email contains **the sender's email, their selected topic, their message, and an IST timestamp** — with Reply To pre-filled so you can respond in one click.
{% endcallout %}

## Variable Mapping Reference

| Template Placeholder | JS Payload Key | What It Sends | Used For |
|---|---|---|---|
| `{{name}}` | `name` | Visitor's email | Identify who wrote in |
| `{{email}}` | `email` | Visitor's email | Reply To field |
| `{{topic}}` | `topic` | Selected option | Subject + triage |
| `{{message}}` | `message` | Textarea content | Enquiry body |
| `{{time}}` | `time` | IST timestamp | When they reached out |

> "Most engineers spend 30 minutes Googling a blank email bug. I looked at the pattern — variable name mismatch — and fixed it in 60 seconds. That's not luck. That's systems thinking."

## Quick Checklist Before Going Live

1. Open your EmailJS template and list every `{{variable}}` used
2. Confirm every template variable has a matching key in the JS payload
3. Set **Reply To** in template settings to `{{email}}`
4. Use **Test It** in the EmailJS dashboard before deploying
5. Check **Email History** if a send seems to work but no email arrives

---

If you're wiring up a contact form and hitting something the checklist above doesn't cover — template variables still blank, emails going to spam, Reply To not routing correctly — I'm happy to help. Reach out at [bilalmeccai.com/#contact](https://bilalmeccai.com/#contact) or bilalmeccai@gmail.com.

---

## Frequently Asked Questions

<details class="faq-item">
  <summary class="faq-q">Why are my EmailJS template variables showing as blank?</summary>
  <div class="faq-a">The variable names in your <code>emailjs.send()</code> payload object don't match the <code>{{placeholder}}</code> names in your template. EmailJS requires an exact character-for-character match. Check spelling and casing on both sides.</div>
</details>

<details class="faq-item">
  <summary class="faq-q">Does EmailJS variable matching work case-sensitively?</summary>
  <div class="faq-a">Yes. <code>{{Name}}</code> and <code>{{name}}</code> are different variables. Always use lowercase consistently across your template and JS payload.</div>
</details>

<details class="faq-item">
  <summary class="faq-q">How do I set up Reply To in EmailJS?</summary>
  <div class="faq-a">In the EmailJS template editor, set the <strong>Reply To</strong> field to <code>{{email}}</code>. Then include <code>email: userEmailAddress</code> in your JS payload. When you hit reply in Gmail, it goes directly to the visitor.</div>
</details>

<details class="faq-item">
  <summary class="faq-q">How do I add an IST timestamp to EmailJS emails?</summary>
  <div class="faq-a">Pass a <code>time</code> key: <code>new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })</code>. Add <code>{{time}}</code> in your template where you want it rendered.</div>
</details>

<details class="faq-item">
  <summary class="faq-q">EmailJS returns 200 but I'm not receiving emails — why?</summary>
  <div class="faq-a">Check: (1) Gmail service is connected in EmailJS → Email Services. (2) Check spam folder. (3) Check EmailJS → Email History for exact status and error codes.</div>
</details>
