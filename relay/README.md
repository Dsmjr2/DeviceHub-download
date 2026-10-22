# DeviceHub problem-report relay

A Cloudflare Worker (free plan) that files DeviceHub's automatic problem reports as issues labeled `problem` in the
private repo Dsmjr2/DeviceHub-support. The GitHub key lives only in the Worker as a secret.

Live at https://devicehub-relay.dsmjr2.workers.dev/report (set up 22 Oct 2026 on Shawn's Cloudflare account).

- Change the code: edit `worker.js`, run `node tests/relay.mjs`, then `npx --yes wrangler@4 deploy` in this folder.
- Replace the GitHub key (fine-grained: only DeviceHub-support, Issues read/write): `npx --yes wrangler@4 secret put GITHUB_TOKEN --name devicehub-relay`.
- Read reports: `gh issue list -R Dsmjr2/DeviceHub-support --label problem`, then `gh issue view <n>`.
