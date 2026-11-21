# Security

Please don't open public issues for security problems. Instead use GitHub's
**Report a vulnerability** button (Security tab → Advisories) on this repository, with steps to reproduce.
We aim to reply within a few business days.

Deployment notes:

- Set `ALLOWED_EMAIL_DOMAINS`, Google sign-in, `SESSION_SECRET` and `NODE_ENV=production`. Without Google keys, production lets nobody in.
- Set the Google OAuth consent screen to **Internal** so only your Workspace can sign in.
- Set `SLACK_TEAM_ID` so only your Slack workspace can use the slash commands and buttons.
- Keep secrets (Slack, Google, database) in your host's settings, never in the repository.
- The calendar feed URL and the WhatsApp group link work for anyone who has them; keep them inside the team.
