import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// Safety net: cytometry data must never end up in a published build. Anything
// in public/ is copied into dist/ verbatim, so after every build remove any
// data files that were sitting there (e.g. local test samples).
function stripDataFiles() {
  const DATA_FILE = /\.(fcs|lmd)$/i
  let outDir = 'dist'
  const sweep = (dir) => {
    let removed = 0
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) {
        removed += sweep(full)
        if (readdirSync(full).length === 0) rmSync(full, { recursive: true })
      } else if (DATA_FILE.test(name)) {
        rmSync(full)
        removed++
      }
    }
    return removed
  }
  return {
    name: 'floschmo-strip-data-files',
    apply: 'build',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir) },
    closeBundle() {
      const removed = sweep(outDir)
      if (removed) console.log(`\n[floschmo] kept ${removed} cytometry data file(s) out of the build output.`)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths, so the same build works at a domain root, under a
  // GitHub Pages project path (https://user.github.io/floschmo/), or anywhere else.
  base: './',
  plugins: [react(), stripDataFiles()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})
