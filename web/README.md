# MemeDB Web

The MemeDB site and admin console: Next.js 16 (App Router), React 19, SWR, Tailwind v4 and shadcn components on Base UI. Browsers' `/api` requests are passed on to the [server](../server/).

## Run

You need [Bun](https://bun.sh) and a running server.

```sh
bun install
bun dev   # http://localhost:3000
```

For production, `bun run build && bun run start`, or the Dockerfile.

| Variable | Default | Sets |
| --- | --- | --- |
| `BACKEND_BASE` | `http://localhost:8080` | Where the Next server reaches the API, read at run time |
| `SITE_URL` | `http://localhost:3000` | Where visitors reach the site, as share cards and canonical links spell it out |

## Layout

```
app/(site)/        The site: search, discover, memes, folders, profiles, tags, library, favorites, settings, API docs
app/(auth)/        Sign-in and sign-up
app/admin/         Admin console
components/ui/     Shared UI components
lib/api.ts         Client fetching through SWR
lib/server-api.ts  Server-side fetching for public pages
lib/types.ts       The server's JSON
lib/i18n/          UI text in Chinese and English, error messages included
```
