# EnterDebt — Accounts Receivable Control System

## Overview

A full-stack web application for managing accounts receivable (дебиторская задолженность) for Enter Group. Built with FastAPI backend and Next.js frontend.

## Architecture

- **Backend**: Python 3.12 + FastAPI + PostgreSQL + SQLAlchemy (port 8000)
- **Frontend**: Next.js 14 + TypeScript + TailwindCSS (port 5000)
- **Database**: Replit PostgreSQL (connected via DATABASE_URL environment variable)

## Project Structure

```
enterdebt/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI entry point, startup seeding
│   │   ├── api/routes/      # API endpoints
│   │   │   ├── auth.py      # JWT auth + /api/auth/login (JSON) + /api/auth/token (form)
│   │   │   ├── users.py     # User management (admin only)
│   │   │   ├── partners.py  # Partner CRUD
│   │   │   ├── payments.py  # Payment CRUD + confirm
│   │   │   ├── dashboard.py # Stats dashboard
│   │   │   └── notifications.py # Notification logs
│   │   ├── core/
│   │   │   ├── config.py    # Settings (reads DATABASE_URL from env)
│   │   │   └── security.py  # JWT + bcrypt auth
│   │   ├── db/database.py   # SQLAlchemy engine + session
│   │   ├── models/          # SQLAlchemy ORM models
│   │   └── schemas/schemas.py # Pydantic schemas
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── pages/           # Next.js pages
    │   ├── components/      # Layout, UI components
    │   ├── context/         # AuthContext
    │   └── lib/api.ts       # Axios client (uses /api proxy)
    ├── next.config.js       # Rewrites /api/* → localhost:8000/api/*
    └── package.json
```

## Workflows

- **"Backend API"**: Runs FastAPI on localhost:8000 (console workflow)
- **"Start application"**: Runs Next.js on 0.0.0.0:5000 (webview workflow)

## Test Accounts (auto-seeded on startup)

| Email | Password | Role |
|---|---|---|
| admin@entergroup.uz | admin123 | Администратор (admin) |
| rustam@kelyanmedia.uz | rustam123 | Менеджер (manager) |
| alisher@kelyanmedia.uz | alisher123 | Менеджер (manager) |
| buh@entergroup.uz | buh123 | Бухгалтерия (accountant) |

## API Routing

The frontend uses Next.js rewrites to proxy `/api/*` to the backend at `localhost:8000/api/*`. This avoids CORS issues and works correctly with Replit's proxy.

## Key Technical Decisions

- bcrypt version pinned to 4.0.1 for passlib compatibility
- Frontend API client uses relative `/api` base URL (proxied by Next.js)
- Backend auth supports both OAuth2 form (`/api/auth/token`) and JSON (`/api/auth/login`)
- Database tables are auto-created and seeded on backend startup
