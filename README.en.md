# bwg-usage

[![CI][ci-badge]][ci]
[![License: MIT][license-badge]](LICENSE)

[中文](README.md) | English

**[Live Demo: bwg-usage.vercel.app](https://bwg-usage.vercel.app/)**

A self-hosted BandwagonHost VPS resource, traffic, and operations dashboard.
Built with React 19.3, vinext 1.0.1, TypeScript, HeroUI, and Vite/Nitro.
Deploy to Vercel or run as a Node service.
The application interface is currently in Simplified Chinese.

The default mode needs no database, Redis, or environment variables.
Enter your own VEID and API Key to connect. Your API Key passes through the panel server
to access KiwiVM, so deploy your own instance or use a trusted operator.
This project is not affiliated with BandwagonHost or KiwiVM.

## Features

- Resource overview: traffic quota, memory/swap/disk configuration, available memory,
  load averages, and throttling status.
- Traffic history: 24-hour, 7-day, and 30-day filters, raw-sample charts, tables, and CSV export.
- Operation records: provider audit and panel commands, filtered by source and outcome.
- Start, stop, and restart with target confirmation and explicit accepted/unknown outcomes.
- Optional browser persistence, automatic reconnection after reload, and separate disconnect/clear.
- Optional panel password, server-managed VPS credentials, and distributed rate limiting.

Designed for one owner and one VPS. Multi-user management, background alerts, connection tools,
and recovery-point management are outside the current feature set.

## Preview

![Desktop dashboard with synthetic VPS data](docs/images/dashboard-desktop.png)

<details>
<summary>Mobile dashboard</summary>

<img src="docs/images/dashboard-mobile.png" alt="375px mobile dashboard" width="375" />

</details>

Screenshots use synthetic data and reserved IP addresses, without real credentials or VPS metadata.

## Quick Start

Requires Node.js 22.13.0 or newer within 22.x and [pnpm](https://pnpm.io/installation) 10.13.1.

```sh
git clone https://github.com/axin7/bwg-usage.git
cd bwg-usage
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:3000`. Sign in to your own VPS through
[KiwiVM](https://kiwivm.64clouds.com/) and open its API menu to obtain your VEID and API Key.
The development server binds to localhost.

Browser persistence is selected by default and stores the API Key in plaintext after validation.
Uncheck it to keep credentials only in page memory. Do not save credentials on a shared device.
Saved current-format credentials are revalidated after reload; an explicit disconnect remains
disconnected in the same tab. Clearing saved credentials does not revoke the provider API Key.

## Deployment

Open the [live panel](https://bwg-usage.vercel.app/) to inspect the interface or test with your own
credentials. To self-host, import your fork into Vercel, select **Other** and **Node.js 22.x**,
and use `vercel.json`. The default browser-managed mode requires no environment variables.
The output includes server-side APIs; this is not a static site.

For password protection, set `APP_ORIGIN`, `PANEL_PASSWORD`, and `SESSION_SECRET` together.
The origin must be a full HTTPS origin without a path or trailing slash.
The password needs at least 16 characters and the session secret at least 32.
Optional server-managed credentials require both `BWG_VEID` and `BWG_API_KEY`,
with panel protection enabled.
Redis is optional; its REST URL and token must be configured together.
Do not prefix secrets with `VITE_` or `NEXT_PUBLIC_`.

For a standalone Node service, run `pnpm build` followed by `pnpm start`.
The production server does not automatically load `.env.local`.
Detailed environment, Preview, startup, and troubleshooting instructions are in
the [deployment guide](docs/DEPLOYMENT.md) (Chinese).

## Validation

```sh
pnpm check
pnpm build:vercel
pnpm verify:vercel
```

Checks run ESLint, TypeScript, Vitest, the Node build, and compiled Vercel integration tests.
Tests use mock providers and do not operate a real VPS or require real credentials.

## Data and Security

History contains raw provider samples, not billing increments or rate predictions.
Unknown fields remain unknown; failed reads retain stale data with their observation time.
Load average is not CPU utilization, and mapped disk capacity is not filesystem free space.
Management requests are never automatically retried; acceptance does not prove completion.

The default mode has no panel login. Origin checks do not authenticate direct HTTP clients,
and in-memory rate limits are per instance. Public deployments need an appropriate access policy.
Nitro integration is beta. One unpatched high-severity `braces` build-tool advisory remains.
See [SECURITY.md](SECURITY.md) for disclosure and known limitations.

## Contributing and License

Use [Issues](https://github.com/axin7/bwg-usage/issues) for bugs and feature requests.
See [CONTRIBUTING.md](CONTRIBUTING.md) (Chinese) for the module map and contribution workflow.
Never post secrets, real logs, or private VPS information in public reports.

Licensed under the [MIT License](LICENSE), copyright 2025-2026 axin7.
Third-party dependencies retain their own licenses.

[ci-badge]: https://github.com/axin7/bwg-usage/actions/workflows/check.yml/badge.svg
[ci]: https://github.com/axin7/bwg-usage/actions/workflows/check.yml
[license-badge]: https://img.shields.io/badge/License-MIT-green.svg
