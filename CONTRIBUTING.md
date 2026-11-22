# Contributing

Thanks for helping. PagerDiem is deliberately small: plain Node.js, no framework, one runtime dependency (`pg`).

1. Fork, then run `./init.sh` (it writes `.env` and installs) and `npm start`. Without Slack/Google keys it runs locally in dry-run mode with email + password sign-in.
2. Make your change with a test in `test/`. Run `npm test`, and against Postgres too if you touch SQL:
   `TEST_DATABASE_URL=postgres://… npm test` (this wipes that database).
3. Keep company-specific values out of the code: anything team-specific belongs in an environment setting with a sensible default, documented in `.env.example` and the README.
4. Open a pull request explaining what changed and why.

SQL must run on both SQLite and Postgres: use `?` placeholders, `ON CONFLICT … DO …`, `RETURNING`, and `CASE` instead of boolean expressions in `ORDER BY`.
