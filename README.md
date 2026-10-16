# PRD → Sprint Planner

A full-stack, AI-powered workflow system that turns a **feature idea** into a
**Product Requirements Document**, **user stories**, **engineering tasks** and a
**prioritised sprint plan**, then stores every run and exposes an **admin
dashboard** for monitoring.

AI is one component in a larger pipeline: it drafts the PRD and task list, and a
deterministic **Smart Logic Layer** then estimates effort, detects dependencies,
scores priority, allocates sprints and assesses delivery risk.

```
User input → Frontend → Backend API → AI generation → Smart logic layer → Database → Admin dashboard
                                                                              ↓
                                                               Structured output (UI)
```

## Features

| Layer | What it does |
|---|---|
| **Frontend** | Validated input form, sample ideas, live pipeline indicator, tabbed output (Overview, PRD, User stories, Tasks, Sprint plan), task filters/sorting, Markdown export, saved-workflow history |
| **Backend API** | Zero-dependency Node.js HTTP server with a small router, JSON validation and error handling |
| **AI generation** | OpenAI (JSON mode) with schema normalisation and a 45 s timeout; automatic fallback to a rule-based generator (keyword-detected capability modules + templates) |
| **Smart logic layer** | Fibonacci effort estimation · dependency detection (layer rules, cycle removal, transitive reduction, critical path) · 0–100 priority score → P0–P3 · capacity-based sprint allocation · risk score with mitigations |
| **Database** | SQLite: `workflows`, `tasks`, `sprints`, `activity_logs`; transactional writes, cascade deletes |
| **Admin dashboard** | KPIs, workflows-per-day chart, source / risk / priority / task-type breakdowns, system health, searchable workflow table (status changes, delete), activity log |

## Run it

Requires **Node.js 22.5+** (uses the built-in `node:sqlite`). On older Node,
`npm install` adds `better-sqlite3` automatically as a fallback driver.

```bash
npm install        # optional on Node 22.5+, there are no required dependencies
npm run seed       # optional: sample workflows for the admin dashboard
npm start          # http://localhost:3000   admin: http://localhost:3000/admin
npm test           # 14 unit + integration tests
```

### On Replit

1. Create a Repl → **Import from GitHub** → paste this repository URL.
2. The included `.replit` file runs `npm start` on Node 22.
3. *(Optional)* In **Tools → Secrets** add `OPENAI_API_KEY` to enable AI
   generation, and `ADMIN_KEY` to password-protect the admin dashboard.
4. Press **Run**. The webview shows the planner; add `/admin` for the dashboard.
5. If your Replit only offers Node 20, change `.replit` to `modules = ["nodejs-20"]`
   and run `npm install` once in the Shell — the app then uses `better-sqlite3`.

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | – | Enables AI generation; without it the rule-based generator is used |
| `OPENAI_MODEL` | `gpt-4o-mini` | Model for generation |
| `ADMIN_KEY` | – | If set, admin API requires header `x-admin-key` |
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `./data/planner.db` | SQLite file |

## API

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/workflows` | Run the pipeline. Body: `featureIdea` (20–2000 chars), `context`, `businessPriority` (low/medium/high/critical), `sprintCapacity` (5–100), `sprintLengthWeeks` (1–3), `useAI` |
| `GET` | `/api/workflows?q=&limit=&offset=` | List / search saved workflows |
| `GET` | `/api/workflows/:id` | Full saved workflow |
| `GET` | `/api/admin/stats` | Dashboard metrics and system health |
| `GET` | `/api/admin/workflows?q=&status=&risk=&source=` | Filtered workflow list |
| `PATCH` | `/api/admin/workflows/:id` | Update status (`new`, `in_review`, `approved`, `archived`) |
| `DELETE` | `/api/admin/workflows/:id` | Delete a workflow with its tasks and sprints |
| `GET` | `/api/admin/activity?level=` | Activity log |
| `GET` | `/api/health` | Health check |

## Project structure

```
server.js                 HTTP server, routing, static files
src/config.js             Environment configuration (.env supported)
src/http.js               Router, JSON body parsing, static file serving
src/validation.js         Input validation
src/pipeline.js           End-to-end orchestration with timing trace
src/generator/            AI generator, rule-based generator, capability modules
src/logic/                effort, dependencies, priority, sprints, risk
src/db.js                 SQLite schema and repository functions
src/routes/               Public workflow API and admin API
public/                   Planner UI and admin dashboard (HTML/CSS/JS)
scripts/seed.js           Sample data
tests/                    node:test unit and integration tests
```

## Development stages (Git history)

1. Project setup – server, config, Replit files
2. Frontend UI – input form and structured output views
3. Backend API + AI generation with rule-based fallback
4. Smart logic layer – effort, dependencies, priority, sprints, risk
5. Database integration – SQLite persistence and history
6. Admin dashboard – monitoring, management, activity log
7. Tests, documentation and polish
