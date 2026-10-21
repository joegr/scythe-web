/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The team's Scythe API, e.g. https://scythe-team-<team>.fly.dev */
  readonly VITE_API_URL?: string
  /** Sign in with Apple Services ID; Apple sign-in is hidden without it. */
  readonly VITE_APPLE_CLIENT_ID?: string
}
