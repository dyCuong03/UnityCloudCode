// src/modules/app-config.ts
// Build-time connection configuration.
//
// Values are baked into the SPA bundle at `npm run build` from Vite `VITE_*`
// env vars, which the CI workflow fills from GitHub Actions variables/secrets
// (see .github/workflows/deploy-adminweb.yml). Baking the project id, operator
// id and module name means the operator never has to type them in the browser —
// the connection form collapses to the environment choice and the proxy token.
//
// NONE of these values are secret: the project id and environment names are
// already visible in Cloud Code request URLs. The only secret (the proxy
// access token) is still entered by hand and kept in memory only.

const env = import.meta.env

// Treat missing AND empty ('' — e.g. an unset GitHub Actions variable that
// still expands to an empty string) as "use the fallback".
function pick(value: string | undefined, fallback = ''): string {
  return (value ?? '').trim() || fallback
}

export interface BuildConfig {
  projectId:     string
  operatorId:    string
  moduleName:    string
  envTesting:    string
  envProduction: string
  defaultEnv:    'testing' | 'production'
}

export const BUILD_CONFIG: BuildConfig = {
  projectId:     pick(env.VITE_PROJECT_ID),
  operatorId:    pick(env.VITE_OPERATOR_ID),
  moduleName:    pick(env.VITE_MODULE_NAME, 'BackpackAdventuresModule'),
  envTesting:    pick(env.VITE_ENV_TESTING, 'testing'),
  envProduction: pick(env.VITE_ENV_PRODUCTION, 'production'),
  defaultEnv:    env.VITE_DEFAULT_ENV === 'production' ? 'production' : 'testing',
}

/** True when the project id was baked at build — hide the input, use the value. */
export const hasBakedProjectId = BUILD_CONFIG.projectId !== ''

/** True when the operator id was baked at build — the field is not needed. */
export const hasBakedOperatorId = BUILD_CONFIG.operatorId !== ''

export interface EnvOption {
  label: string
  value: string
}

/** Environment dropdown choices. Values are the UGS environment names the
 *  proxy resolves to UUIDs server-side. */
export function environmentOptions(): EnvOption[] {
  return [
    { label: 'Testing',    value: BUILD_CONFIG.envTesting },
    { label: 'Production', value: BUILD_CONFIG.envProduction },
  ]
}

/** The environment value selected by default (first connect / after logout). */
export function defaultEnvValue(): string {
  return BUILD_CONFIG.defaultEnv === 'production'
    ? BUILD_CONFIG.envProduction
    : BUILD_CONFIG.envTesting
}

/** Resolve a stored/candidate environment to a valid dropdown value, falling
 *  back to the default when it does not match a known option. */
export function resolveEnvValue(candidate: string): string {
  const opts = environmentOptions().map(o => o.value)
  return opts.includes(candidate) ? candidate : defaultEnvValue()
}
