# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Chanflix** is a fork of Overseerr - a media request management application. This fork is being customized for personal use with Plex authentication and custom branding.

- **Upstream**: https://github.com/sct/overseerr
- **This fork**: https://github.com/herboh/chanflix

## Development Commands

```bash
yarn install                    # Install dependencies
yarn dev                        # Dev server with hot reload (watches server + frontend)
yarn build                      # Production build (Next.js + TypeScript server)
yarn start                      # Run production server (port 5055)
yarn lint                       # ESLint
yarn typecheck                  # TypeScript validation
yarn format                     # Prettier formatting
```

### Database Migrations
```bash
yarn migration:run              # Apply pending migrations
yarn migration:generate         # Generate migration from entity changes
yarn migration:create           # Create empty migration file
```

### Testing
```bash
yarn cypress:open               # Open Cypress E2E test UI
yarn cypress:prepare            # Prepare test database
yarn cypress:build              # Full build + test prep
```

## Code Architecture

### Frontend (`src/`)
- **Framework**: Next.js 12 + React 18 + TypeScript
- **Styling**: Tailwind CSS with custom utilities
- **State**: React Context (UserContext, SettingsContext) + SWR for data fetching
- **i18n**: react-intl with translations in `src/i18n/locale/`

Key directories:
- `src/pages/` - Next.js pages/routing
- `src/components/` - React components (50+ major components)
- `src/context/` - React context providers
- `src/hooks/` - Custom hooks

### Backend (`server/`)
- **Framework**: Express.js + TypeScript
- **ORM**: TypeORM with SQLite
- **Auth**: Plex OAuth + local auth, sessions via express-session

Key directories:
- `server/routes/` - API endpoints (`/api/v1/*`)
- `server/entity/` - TypeORM entities (User, MediaRequest, Media, etc.)
- `server/api/` - External API clients (Plex, TMDB, Radarr, Sonarr)
- `server/lib/` - Business logic, permissions, notifications
- `server/migration/` - Database migrations

### Path Aliases
Defined in `tsconfig.json`:
- `@app/*` → `src/*`
- `@server/*` → `server/*`

## Key Files for Customization

### Branding
- `public/logo_full.svg` - Main logo
- `public/logo_full.png` - PNG logo
- `public/favicon-16x16.png`, `public/favicon-32x32.png` - Favicons
- `public/os_logo_filled.png` - Filled logo variant
- `src/styles/globals.css` - `.text-overseerr` brand color class

### Authentication
- `server/routes/auth.ts` - Auth endpoints
- `server/api/plexapi.ts` - Plex server integration
- `server/api/plextv.ts` - Plex.tv API (auth, users)
- `server/lib/permissions.ts` - Permission flags

### External Integrations
- `server/api/servarr/radarr.ts` - Radarr API
- `server/api/servarr/sonarr.ts` - Sonarr API
- `server/api/themoviedb/` - TMDB metadata
- `server/api/tautulli.ts` - Tautulli stats

## Database

SQLite database stored at `config/db/db.sqlite3` (configurable via `CONFIG_DIRECTORY` env var).

Key entities:
- `User` - User accounts (Plex or local)
- `MediaRequest` - Movie/TV requests with approval workflow
- `Media` - Cached media metadata and availability status
- `Session` - Express session storage

## Deployment

Deployed via Docker Compose from `~/docker/`:
```bash
cd ~/docker
docker compose up -d --build chanflix
```

Service accessible at `https://chanflix.chanflix.com` via Traefik reverse proxy.

Runtime config/database stored at `~/docker/chanflix/` (mounted to `/app/config` in container).

## MVP Goals

1. **Plex-only authentication** - Remove/hide local auth options
2. **Rebrand to Chanflix** - Update all "Overseerr" references, logos, colors
3. **Enhanced features**:
   - Open media directly in Plex from the UI
   - View download progress from Radarr/Sonarr
   - Monitor stuck/failed jobs
   - Basic library management

## API Documentation

Local Swagger UI available at `http://localhost:5055/api-docs` when running dev server.
