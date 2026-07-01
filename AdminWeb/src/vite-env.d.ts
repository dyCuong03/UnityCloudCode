/// <reference types="vite/client" />

// Build-time connection configuration, baked from GitHub Actions
// variables/secrets via Vite `VITE_*` env vars at `npm run build`.
// See src/modules/app-config.ts and .github/workflows/deploy-adminweb.yml.
interface ImportMetaEnv {
  readonly VITE_PROJECT_ID?:     string
  readonly VITE_OPERATOR_ID?:    string
  readonly VITE_MODULE_NAME?:    string
  readonly VITE_ENV_TESTING?:    string
  readonly VITE_ENV_PRODUCTION?: string
  readonly VITE_DEFAULT_ENV?:    string
  readonly VITE_BASE?:           string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
