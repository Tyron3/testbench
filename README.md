# Testbench

Six tools test engineers reach for most days: a task queue, a code reviewer, a test-case
deriver, a flaky-test tracker, a data and schedule bench, and a bug report builder.

Vite + React. Entirely client side — no backend, no API keys, no network calls.

## Run it locally

```bash
npm install
npm run dev
```

That's the whole app — every tool works offline.

## Deploy

```bash
git init && git add -A && git commit -m "Testbench"
# push to GitHub or GitLab, then import the repo at vercel.com/new
```

Vercel detects Vite on its own. No build settings, no environment variables, no `vercel.json`.
From the CLI it's `vercel --prod`.

Since it's a static bundle, anywhere that serves files works just as well — Netlify, GitHub
Pages, Cloudflare Pages, or an S3 bucket.

## No API key needed

Review and Cases run entirely in the browser:

- **Review** is a static analyser. Around 30 hand-written rules across three lenses, matched
  line by line, reporting line numbers. Your code never leaves the page.
- **Cases** derives boundary values, equivalence partitions and error-guessing cases from the
  field constraints you declare. Deterministic — the same input gives the same set every time,
  which is what you want for something you'll paste into a test plan.

There is no `api/` directory and no environment variables to configure. `npm run dev` runs the
whole app; `vercel dev` is no longer needed.

## Notes

- State lives in `localStorage` under `testbench:state` — per browser, not synced, and gone if
  you clear site data. Swapping in a real store means replacing `loadState` and `saveState` at
  the top of `src/App.jsx`; nothing else touches storage.
- Review rules live in the `RULES` object near the top of the Review module. Each is an object
  with an id, a severity, a title, the fix, and a regex. Adding one of your team's own
  conventions is a few lines.
- A clean Review result means nothing tripped these rules. It is not a statement that the code
  is good.
