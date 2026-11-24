# PagerDiem phone app

The iPhone (and, next, Android) app for PagerDiem: pages ring like a phone call, and answering
acknowledges them. Built with Expo; the design and decisions are in
`../docs/superpowers/specs/2026-11-24-phone-app-design.md`.

## Run it

```bash
npm install
npm run ios        # builds and opens it on the iOS Simulator
```

To try it against a seeded local PagerDiem, and to make pages really ring, see `e2e/README.md`.

## Check it

```bash
npm test           # Jest
npm run typecheck  # TypeScript
```

## Build your own

The app's name, bundle id and Apple team come from the environment (`APP_NAME`, `APP_BUNDLE_ID`,
`APPLE_TEAM_ID`), so a team running its own PagerDiem can publish its own build. Android also needs
that team's Firebase `google-services.json` here (or `GOOGLE_SERVICES_FILE`); it isn't in git.
Before each store release, run `docs/release-checklist.md`.
