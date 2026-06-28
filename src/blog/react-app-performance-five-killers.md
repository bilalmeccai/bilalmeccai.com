---
layout: post
title: "Five Performance Killers in React Apps (And How to Spot Them Fast)"
subtitle: "N+1 queries, unnecessary re-renders, missing caches, memory leaks, redundant computations — these five patterns account for 90% of slow React apps. Here's how to find and fix each one."
description: "Learn to identify and fix the five most common React app performance killers: N+1 queries, unnecessary re-renders, caching gaps, memory leaks, and redundant computations."
date: 2026-06-28
tags:
  - posts
  - React
  - Performance
  - JavaScript
  - Web Engineering
category: "Web Engineering"
tldr: "Most slow React apps share the same five problems: <strong>N+1 queries</strong> (fetching in loops), <strong>unnecessary re-renders</strong> (missing <code>memo</code>/<code>useCallback</code>), <strong>missing caches</strong> (re-fetching data you already have), <strong>memory leaks</strong> (uncleaned listeners/subscriptions), and <strong>redundant computations</strong> (expensive logic running on every render). Fix these five and most performance complaints disappear."
faq:
  - q: "What is an N+1 query problem in a React app?"
    a: "An N+1 query happens when you fetch a list of N items, then make one additional API/database call per item inside a loop. For 50 items, that's 51 requests instead of 1. Fix it by fetching related data in a single batch request or using a data-fetching library that supports query batching."
  - q: "How do I find unnecessary re-renders in React?"
    a: "Install the React DevTools browser extension, open the Profiler tab, and record a typical interaction. Components that flash on every state change without their props changing are rendering unnecessarily. Wrap them in React.memo() and stabilise their props with useMemo/useCallback."
  - q: "What causes memory leaks in React apps?"
    a: "The most common causes are: event listeners added in useEffect without a cleanup function, subscriptions (WebSocket, RxJS, Supabase real-time) not unsubscribed on unmount, and intervals/timers not cleared when a component is destroyed."
  - q: "When should I use useMemo vs useCallback in React?"
    a: "Use useMemo to cache the result of an expensive computation (a derived value). Use useCallback to cache the function reference itself — typically so a memoised child component doesn't re-render because its prop function was recreated. Both only help when the dependency arrays are correct."
  - q: "How do I add caching to React API calls without a library?"
    a: "For simple cases, store results in a module-level Map keyed by the request parameters. For production apps, reach for React Query (TanStack Query) — it handles stale-while-revalidate, deduplication, and cache invalidation with almost no boilerplate."
---

## The Pattern I Keep Seeing

Whether it's a US-based fintech platform or a small SaaS I'm auditing, slow React apps follow the same script. The team has shipped features fast, the app works, users start complaining it feels sluggish — and nobody's quite sure where the time went.

After profiling enough of these, five patterns account for the majority of the slowdown. Every. Single. Time.

Here they are, ranked by how often I find them.

---

## 1. N+1 Queries — The Silent Request Flood

This is the most common and the easiest to miss because it looks totally fine in the component code.

**The pattern:**

```js
// You fetch a list of projects
const { data: projects } = useQuery(['projects'], fetchProjects);

// Then for each project, you fetch its owner separately
return projects.map(project => (
  <ProjectCard
    key={project.id}
    project={project}
    owner={useQuery(['user', project.ownerId], () => fetchUser(project.ownerId))} // ❌
  />
));
```

For 30 projects, this fires 31 network requests. Open the Network tab in DevTools and you'll see a waterfall that looks like a piano roll.

**The fix — fetch related data in one go:**

```js
// Option 1: batch at the API level
const { data } = useQuery(['projects-with-owners'], fetchProjectsWithOwners);
// → one request that JOINs owners server-side

// Option 2: fetch once, look up from a map
const ownerIds = projects.map(p => p.ownerId);
const { data: owners } = useQuery(
  ['users', ownerIds],
  () => fetchUsersByIds(ownerIds),
  { enabled: ownerIds.length > 0 }
);
const ownerMap = Object.fromEntries(owners.map(o => [o.id, o]));
```

The mental check: **if you see a fetch call inside a `.map()`, stop and ask whether it can be batched.**

---

## 2. Unnecessary Re-renders — The Cascading Repaint

React's default behaviour is to re-render a component whenever its parent re-renders, even if the component's own props haven't changed. In a tree with 20+ components, one state update near the top can trigger dozens of wasted renders.

**Find them with the Profiler:**

1. Install [React DevTools](https://react.dev/learn/react-developer-tools)
2. Open DevTools → Profiler → Record
3. Do something that feels slow (open a dropdown, type in a field)
4. Stop recording — any component highlighted in yellow rendered in that interaction

**The most common cause — unstable function references:**

```js
// ❌ A new function reference is created on every render of Parent
function Parent() {
  const handleClick = () => doSomething(); // new ref every render
  return <ExpensiveChild onClick={handleClick} />;
}

// ✅ Stable reference with useCallback
function Parent() {
  const handleClick = useCallback(() => doSomething(), []);
  return <ExpensiveChild onClick={handleClick} />;
}

// ✅ Child opts out of re-renders when props haven't changed
const ExpensiveChild = React.memo(function ExpensiveChild({ onClick }) {
  return <button onClick={onClick}>Click</button>;
});
```

**The rule:** `React.memo` stops the re-render at the component boundary. `useCallback` and `useMemo` keep the props stable so `memo` can actually do its job. You need both.

---

## 3. Missing Caches — Fetching What You Already Have

This one is almost embarrassing once you see it, but it's endemic in codebases that grew organically.

**Symptom:** Open the Network tab. Navigate between pages. Watch the same API calls fire over and over — same URL, same response, every time you visit a route.

**The minimal fix — module-level cache:**

```js
const cache = new Map();

async function fetchProduct(id) {
  if (cache.has(id)) return cache.get(id);
  const data = await api.get(`/products/${id}`);
  cache.set(id, data);
  return data;
}
```

**The production fix — React Query:**

```js
import { useQuery } from '@tanstack/react-query';

// First visit: fetches from API, caches result
// Second visit: returns cached data instantly, revalidates in background
function ProductPage({ id }) {
  const { data } = useQuery({
    queryKey: ['product', id],
    queryFn: () => fetchProduct(id),
    staleTime: 5 * 60 * 1000, // consider fresh for 5 minutes
  });
}
```

React Query also deduplicates: if ten components mount simultaneously and all request the same data, only one network request fires.

---

## 4. Memory Leaks — The Crash That Takes Days to Show Up

Memory leaks in React are almost always caused by async work that completes after a component has unmounted — and tries to update state that no longer exists.

**The classic pattern:**

```js
// ❌ Leak: setData called on unmounted component
function Dashboard() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetchDashboardData().then(result => setData(result)); // no cleanup
    window.addEventListener('resize', handleResize);       // never removed
  }, []);
}
```

If the user navigates away before the fetch resolves, React logs a warning and the state update is a no-op — but the event listener stays attached forever.

**The fix — clean up everything in useEffect's return:**

```js
// ✅ Proper cleanup
useEffect(() => {
  let cancelled = false;

  fetchDashboardData().then(result => {
    if (!cancelled) setData(result); // guard against unmount
  });

  window.addEventListener('resize', handleResize);

  return () => {
    cancelled = true;
    window.removeEventListener('resize', handleResize);
  };
}, []);
```

**Other common leaks:**
- WebSocket connections not closed on unmount
- RxJS subscriptions not unsubscribed
- `setInterval` / `setTimeout` not cleared
- Third-party SDK listeners (analytics, Intercom, etc.) not torn down

**To confirm a leak exists:** Open Chrome DevTools → Memory → take a heap snapshot. Navigate around the app for a few minutes. Take another snapshot. Compare — if detached DOM nodes keep growing, you have a leak.

---

## 5. Redundant Computations — Expensive Logic Running in Render

Anything computed directly in the render function runs on every render. If it's expensive — filtering a large list, parsing dates, sorting — you're paying that cost constantly.

**The problem:**

```js
function ProductList({ products, searchTerm }) {
  // ❌ Runs on every render, even if products and searchTerm haven't changed
  const filtered = products
    .filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => a.price - b.price);

  return filtered.map(p => <ProductCard key={p.id} product={p} />);
}
```

**The fix — useMemo with correct dependencies:**

```js
function ProductList({ products, searchTerm }) {
  // ✅ Only recomputes when products or searchTerm changes
  const filtered = useMemo(() =>
    products
      .filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
      .sort((a, b) => a.price - b.price),
    [products, searchTerm]
  );

  return filtered.map(p => <ProductCard key={p.id} product={p} />);
}
```

**When NOT to use useMemo:** On trivial computations. Memoisation has overhead — the dependency comparison and cache storage. For simple string concatenations or basic arithmetic, it's slower than just computing the value. Use it when the operation involves iterating over arrays of 50+ items or doing non-trivial transforms.

---

## How to Triage a Slow React App in 20 Minutes

When I land on a new codebase that "feels slow," here's the exact sequence:

1. **Network tab** — filter by XHR/Fetch. Reload the page. Count requests. Look for repeated calls, waterfalls, large payloads.
2. **React Profiler** — record the specific interaction that's slow. Identify the highest-rendering components.
3. **Performance tab** — record 3 seconds of the interaction. Look for long tasks (red bars > 50ms) in the flame graph.
4. **Memory tab** — heap snapshot before and after heavy usage. Check for detached DOM nodes.
5. **Search for the patterns** — `map(` with `fetch` or `useQuery` inside, `useEffect` without a return function, expensive computations outside `useMemo`.

You'll have a prioritised list within 20 minutes. Fix in order of impact — N+1 queries and missing caches almost always win.

---

## Quick Reference

| Problem | Detection | Fix |
|---|---|---|
| N+1 queries | Network tab — request waterfall | Batch fetch, JOIN server-side |
| Unnecessary re-renders | React Profiler — yellow components | `React.memo` + `useCallback`/`useMemo` |
| Missing cache | Network tab — duplicate requests | React Query / module-level Map |
| Memory leaks | Memory tab — detached DOM nodes | Cleanup in `useEffect` return |
| Redundant computations | Profiler — long scripting time | `useMemo` with correct deps |

---

<details>
<summary><strong>FAQ</strong></summary>

**What is an N+1 query problem in a React app?**
An N+1 query happens when you fetch a list of N items and then make one additional API call per item inside a loop. For 50 items, that's 51 requests. Fix it by fetching related data in a single batched request.

**How do I find unnecessary re-renders?**
Use the React DevTools Profiler. Record a user interaction and look for components that rendered without their props changing. Those are candidates for `React.memo`.

**When should I use useMemo vs useCallback?**
`useMemo` caches a computed value. `useCallback` caches a function reference. Use `useCallback` when passing callbacks to memoised child components — otherwise the child sees a new prop every render and re-renders anyway.

**What causes memory leaks in React?**
Usually: event listeners not removed in `useEffect` cleanup, async operations that update state after unmount, or subscriptions (WebSocket, real-time, timers) not torn down.

**Is React Query worth adding just for caching?**
Yes, for any app that makes more than a handful of API calls. The deduplication alone pays for itself — it prevents multiple components from firing identical requests on mount.

</details>
