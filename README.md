# Movie Album

A personal, paper-inspired film collection. It can run locally with IndexedDB or use a shared Supabase database when published. Film details and posters come from TMDB.

## Run locally

1. Create a TMDB API Read Access Token in [TMDB API settings](https://www.themoviedb.org/settings/api).
2. Copy `.env.example` to `.env.local` and add your token after `VITE_TMDB_TOKEN=`.
3. Install dependencies with `npm install`.
4. Start the app with `npm run dev` and open the local URL printed in the terminal.

Without Supabase settings, your collection stays in this browser on this device. Clearing the site's browser data removes the local collection.

## GitHub Pages deployment

The repository includes a GitHub Actions workflow that builds and publishes the static site whenever a commit is pushed to `main`. After pushing the project to GitHub, enable **Settings → Pages → Build and deployment → GitHub Actions**.

### Connect Supabase

1. Create a Supabase project on the Free plan.
2. Link this folder to the project with the Supabase CLI and apply the schema: `npx supabase login`, `npx supabase link --project-ref YOUR_PROJECT_REF`, then `npx supabase db push`.
3. Add the TMDB Read Access Token to Supabase as the `TMDB_API_READ_ACCESS_TOKEN` function secret, then deploy the proxy with `npx supabase functions deploy tmdb`.
4. In GitHub, add the Supabase Project URL as the Actions variable `VITE_SUPABASE_URL` and the publishable/anon key as `VITE_SUPABASE_ANON_KEY` under **Settings → Secrets and variables → Actions → Variables**. The anon key is designed to be public; never use the `service_role` key in the site.
5. Enable Pages with **Settings → Pages → Build and deployment → GitHub Actions**. Each push to `main` will publish the site.

To preserve the collection currently open at `localhost:5173`, first add the Supabase URL and anon key to `.env.local`, restart the local app, and open it once. While the remote table is empty, the local app imports its IndexedDB entries to Supabase. GitHub Pages runs on a different browser origin and cannot read the localhost database. If Supabase already contains entries, those are kept and local data is not imported.

**This collection is public by choice:** anyone can read, add, change, or delete entries. Do not put private information in it. Supabase currently includes a 500 MB database on its Free plan; free projects pause after one week of inactivity.

## Before publishing online

For the public site, TMDB requests go through the Supabase Edge Function in `supabase/functions/tmdb`; the TMDB token stays in Supabase's server-side function secrets. The local direct-token setting is for local use only and must not be added to the GitHub Actions build.

TMDB attribution appears in the app footer with the official TMDB logo, a link to TMDB, and the required notice: “This product uses the TMDB API but is not endorsed or certified by TMDB.” The logo is bundled from TMDB's official Logos & Attribution page and is displayed without modification. Movie data and images remain TMDB's materials; this personal project is intended for non-commercial use. If the project's primary purpose changes to generating revenue, contact TMDB about a commercial license before continuing that use.

## Album behavior

- All Movies sorts newest additions first. Movies in director, genre, and decade groups sort by title.
- Each album page shows up to six films (up to twelve per desktop spread); narrow screens show six films per page.
- Unwatched posters are grayscale. Marking a film watched colors its poster and stores the watched date.
- Only `tmdb_id`, `watched`, `added_at`, and `watched_at` are stored for each album entry (plus an IndexedDB row key). TMDB metadata is fetched as needed.
