# Express TypeScript Starter

A small, production-minded Express 5 + TypeScript starter.

## Requirements

- Node.js 24 LTS (or another supported LTS compatible with your deployment)
- npm

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

Try:
- `GET http://localhost:3000/`
- `GET http://localhost:3000/api/v1/health`

## Scripts

- `npm run dev`: development server with reload
- `npm run build`: compile TypeScript into `dist/`
- `npm start`: run compiled server
- `npm run typecheck`: TypeScript checks
- `npm run lint`: ESLint
- `npm run format`: Prettier
- `npm test`: run tests

## Structure

```text
src/
  app.ts                 # Configure Express and middleware
  server.ts              # Listen, graceful shutdown
  config/env.ts          # Validate environment variables
  lib/logger.ts           # Shared structured logger
  middleware/
    error-handler.ts     # Central error handler
    not-found.ts          # Consistent 404
  modules/
    health/
      health.routes.ts   # Health endpoint
      health.test.ts     # API integration tests
```

## Conventions

- Keep `app.ts` separate from `server.ts` so tests can import the app without opening a port.
- Put routes and domain logic into feature modules, not one giant route file.
- Validate all external input at the boundary (e.g. Zod).
- Use parameterized queries; never concatenate user input into SQL.
- Do not commit `.env` or secrets.
- Use migrations for schema changes.
- Add authentication, authorization, rate limiting, and request size limits before exposing sensitive endpoints publicly.
- Configure CORS to known frontend origins in production.
- Keep logs structured and redact secrets.
- Add request IDs and observability when the app grows.
- Keep business logic out of route handlers as the domain grows: route -> service -> repository.
