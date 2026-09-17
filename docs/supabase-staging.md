# Supabase staging: the one required account step

Orchidarium can apply its migrations and import the latest audited GBIF catalog
without running commands on a local computer. GitHub Actions performs those
operations through `.github/workflows/deploy-supabase.yml`.

Creating the Supabase project itself still requires the project owner's action.
It creates an external cloud resource, accepts Supabase terms, selects a region,
and may affect billing. Neither the repository nor GitHub's standard token has
authority over the owner's Supabase account.

## 1. Create the staging project

1. Sign in at the Supabase dashboard.
2. Select **New project**.
3. Choose the organization and a nearby region.
4. Name the project `orchidarium-staging`.
5. Generate and save a strong database password.
6. Wait until provisioning completes.

Do not paste passwords, access tokens, or service-role keys into an issue, pull
request, source file, or chat message.

## 2. Add three protected GitHub environment secrets

In the GitHub repository, open **Settings → Environments**, create an
environment named `supabase-staging`, and add:

| Secret | Where to obtain it |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Supabase account settings → Access Tokens |
| `SUPABASE_DB_PASSWORD` | The database password saved during project creation |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project settings → API keys; server-only service-role key |

These values are consumed only by the protected deployment job. The service-role
key is never placed in the browser configuration.

## 3. Run the deployment

1. In GitHub, open **Actions → Deploy Orchidarium to Supabase staging**.
2. Select **Run workflow**.
3. Enter the project reference shown in the Supabase project URL. For
   `https://abcdefgh.supabase.co`, enter `abcdefgh`.
4. Leave **Import the latest validated GBIF catalog** enabled.
5. Leave **Reset an untracked partial schema** disabled for a normal deployment.
6. Confirm **Run workflow**.

The workflow links the project, applies all migrations, finds the latest
successful GBIF artifact, audits it again, validates it without writes, and then
imports the catalog in bounded batches. It deliberately never creates or
deletes a Supabase project.

If an earlier manual or interrupted setup left database objects that are not
tracked in the migration history, rerun the workflow with **Reset an untracked
partial schema** enabled. This recovery option resets the linked staging
database without loading the demo seed, then reapplies the repository
migrations before importing the catalog. It is intentionally disabled by
default because it deletes existing staging data; do not enable it for a normal
incremental deployment or against a production project.

## 4. Public browser configuration

After a successful deployment, copy `config.example.js` to `config.js` for local
testing and set the project URL plus its browser-safe publishable/anon key. Never
use `SUPABASE_SERVICE_ROLE_KEY` in `config.js`.
