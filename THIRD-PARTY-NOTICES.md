# Third-party notices — Manager (manager.polecat.live)

Manager is open source under the **GPL-3.0** license and is built as a
static, no-build-step web app. It bundles **no third-party runtime
libraries**: the UI is first-party code plus a vendored copy of the
**Polecat Shell** (`vendor/polecat-shell/`), which is itself part of the
Polecat suite (`kevinrhaas/polecat-platform`, GPL-3.0) — not a third party.

## External services (contacted only when you configure them)

Manager can connect to external data services using credentials you provide;
it bundles none of their code and sends your keys only to the service you
chose (BYOK, client-side):

- **GitHub REST API** — fleet/repo status.
- **Turso (libSQL HTTP)** — optional cloud datastore.
- **Supabase** — optional cloud datastore.
- **Google Firestore (REST)** — optional cloud datastore.

Each is used per its own terms; Manager stores your configuration in your
browser's local storage only.
