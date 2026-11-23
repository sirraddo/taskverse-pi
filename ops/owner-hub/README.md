# SIRRADDO owner hub

Public status page (`/`) and private owner dashboard (`/owner`) for Zappi NG, TaskVerse and ZAPPI PAY.
Runs on the VPS next to the apps (no database; history in `data/state.json`).

Install on the VPS: `bash vps-app.sh add owner-hub 4103 status.sirraddo.com.ng https://github.com/sirraddo/taskverse-pi.git ops/owner-hub`

Settings (`.env`): `OWNER_PASSWORD`, `SESSION_SECRET`, `OWNER_KEY` (same value in the three apps), optional `RESEND_API_KEY`, `ALERT_EMAIL`, `EMAIL_FROM`.
Watched addresses: `services.js`. Tests: `npm test`.
