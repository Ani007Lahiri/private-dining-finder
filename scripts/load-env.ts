// Standalone scripts (run via tsx, not through Next) do not auto-load .env.local
// the way `next dev` / `next build` do. Importing this module FIRST — before any
// module that reads process.env, i.e. before ../src/lib/config — makes the eval
// and seed-push scripts honour .env.local exactly as the app does.
import { loadEnvConfig } from '@next/env'

loadEnvConfig(process.cwd(), true)
