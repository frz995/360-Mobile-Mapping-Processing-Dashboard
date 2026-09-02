// Cross-platform ESLint flat-config launcher for the `lint` npm script.
// ESLint 8.57 CLI needs ESLINT_USE_FLAT_CONFIG=true to load eslint.config.mjs.
// We set it in-process then spawn the CLI as a child so a fresh eslint module
// picks it up (avoiding fragile inline env vars on Windows).
// Legacy code is linted at WARN severity (non-blocking); only errors fail the
// run so the gate stays real but not blocking yet.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

process.env.ESLINT_USE_FLAT_CONFIG = 'true'

const here = path.dirname(fileURLToPath(import.meta.url))
const eslintBin = path.resolve(here, '..', 'node_modules', 'eslint', 'bin', 'eslint.js')
const nodeExec = process.execPath

const result = spawnSync(nodeExec, [eslintBin, 'src', 'vitest.config.ts'], { stdio: 'inherit' })

process.exit(result.status ?? 1)
