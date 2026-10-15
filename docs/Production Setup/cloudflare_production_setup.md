# Cloudflare Pages production setup — superseded

**This document has been replaced.** It described a BFF gateway (`worker/bff/`)
that has been removed, referenced a `WORKER_URL` variable no code reads, and
instructed operators to curl a `/metrics` endpoint the worker no longer exposes.
It also omitted the full `cloudflared` setup sequence, which was never documented
anywhere in the repository.

The current guidance is:

- **[`docs/Production Setup/01-Infrastructure.md`](<docs/Production Setup/01-Infrastructure.md>) §6** — Cloudflare Tunnel: install, create named tunnels, `config.yml` ingress for five hostnames, DNS routing, autostart as a service
- **[`docs/Production Setup/01-Infrastructure.md`](<docs/Production Setup/01-Infrastructure.md>) §7** — Cloudflare Pages: build settings (including the Root Directory requirement that keeps the Pages Functions deployed), build-time vs runtime variables, and why static-only self-hosting does not work

For the on-prem services behind those tunnels, see
**[`docs/Production Setup/02-Operations.md`](<docs/Production Setup/02-Operations.md>)**.