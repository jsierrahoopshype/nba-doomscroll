# NBA Doomscroll

An endless, personalized feed of NBA content — a section of [HoopsMatic](https://hoopsmatic.com).

Static site, GitHub Pages deploy, no backend for users. A simple non-ML
personalization algorithm runs entirely in the browser: every card is tagged
(content type, players, teams, era, category) and likes/saves/tap-throughs
re-weight what surfaces next. All personalization data lives in localStorage
only, with JSON export/import.

## Tabs

For You (algorithmic mix) · Trades (community Trade Machine feed) · Rumors
(HoopsHype archive, on-this-day) · VS (player comparisons + trivia) · Quiz
(guess the player, ballot trivia) · Vault (salary history, ballot oddities,
on-this-day games, bar chart races).

## Repo layout

- `index.html` + `css/` + `js/` — the app (no framework, vanilla JS)
  - `js/engine.js` — personalization engine (weights, sampling, storage)
  - `js/cards.js` — card renderers
  - `js/app.js` — shell: tabs, infinite feed, interactions, panels
- `data/dummy-cards.json` — synthetic card pool used while sources are wired
  in (rumor text in it is invented placeholder content, never archive data)
- `data/rumor-blocklist.json` — editable keyword blocklist for the Rumors
  editorial filter
- `tools/` — build/generation scripts

## Local dev

From the repo root: `python -m http.server 8000` then open
http://localhost:8000/ (fetch() needs a server, file:// won't load the JSON).

## Status

Step 2 of 6: feed shell + personalization engine running on sample data.
Data sources (trade log, rumors archive endpoints, comparison engine, ballot
data, vault datasets) land in steps 3-5; share images and polish in step 6.
