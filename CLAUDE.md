# CLAUDE.md

## Deployment

- This web app runs on Render, not locally. Render deploys it automatically from the `main` branch of this GitHub repo.
- Build command on Render: `npm install && npm run build`
- Start command on Render: `npm start`
- Render provides the `PORT` environment variable; the server must listen on it.

## Database

- The database is a Render PostgreSQL database, available only through the `DATABASE_URL` environment variable on Render.

## Rules

- Do not set up a local database or a local server.
- Before every push, run `npm run build` to make sure the app builds.
- After each finished task, commit and push to GitHub so that Render deploys the new version.
