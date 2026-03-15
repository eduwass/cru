#!/usr/bin/env bun
/**
 * Release script — bumps version, tests, publishes.
 * Usage: bun scripts/release.ts [major|minor|patch]
 */
import { $ } from 'bun'
import pkg from '../package.json'

const bump = (Bun.argv[2] || 'patch') as 'major' | 'minor' | 'patch'
const [major, minor, patch] = pkg.version.split('.').map(Number)

const next = {
  major: `${major + 1}.0.0`,
  minor: `${major}.${minor + 1}.0`,
  patch: `${major}.${minor}.${patch + 1}`,
}[bump]

if (!next) {
  console.error('Usage: bun scripts/release.ts [major|minor|patch]')
  process.exit(1)
}

console.log(`Bumping ${pkg.version} → ${next} (${bump})`)

// Run tests
await $`bun test tests/unit/`

// Bump version
await $`npm version ${next} --no-git-tag-version`

// Commit, tag, push
await $`git add package.json`
await $`git commit -m ${'chore: bump version to ' + next}`
await $`git tag v${next}`
await $`git push && git push --tags`

// GitHub release
await $`gh release create v${next} --generate-notes`

// Publish to npm
await $`npm publish --access public`

// Update global install
await $`bun update -g cru-teams`

console.log(`\nReleased v${next} — published to npm and updated global install.`)
