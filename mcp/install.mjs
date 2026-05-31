#!/usr/bin/env node
/**
 * Cross-platform installer for the kai-planner MCP connector.
 *
 * It wires `kai-planner-mcp.mjs` into Claude Desktop (and optionally prints the
 * Claude Code command) on Windows, macOS, or Linux by merging an entry into the
 * Claude Desktop config WITHOUT touching any other connectors you already have.
 *
 * Usage:
 *   node install.mjs --api-key <KEY> [--cf-id <ID> --cf-secret <SECRET>] [--base-url <URL>]
 *
 * Secrets may also come from the environment:
 *   KAI_API_KEY, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET, KAI_BASE_URL
 *
 * The server file is expected to sit next to this installer. If it is missing,
 * download it first from:
 *   https://raw.githubusercontent.com/pikalover6/kaihoward/main/mcp/kai-planner-mcp.mjs
 */

import { homedir, platform } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'

const HERE = dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'
      out[key] = val
    }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))

const apiKey = args['api-key'] || process.env.KAI_API_KEY || ''
const cfId = args['cf-id'] || process.env.CF_ACCESS_CLIENT_ID || ''
const cfSecret = args['cf-secret'] || process.env.CF_ACCESS_CLIENT_SECRET || ''
const baseUrl = args['base-url'] || process.env.KAI_BASE_URL || 'https://kaihoward.com/personal/api'

if (!apiKey) {
  console.error('ERROR: no API key. Pass --api-key <KEY> or set KAI_API_KEY.')
  process.exit(1)
}

// Resolve the Claude Desktop config path for this OS.
function claudeConfigPath() {
  if (args.config) return resolve(args.config)
  const p = platform()
  if (p === 'win32') return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
  if (p === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'Claude', 'claude_desktop_config.json')
}

// Keep a stable copy of the server outside any throwaway clone so the path never breaks.
function stableServerPath() {
  const dir = join(homedir(), '.kai-planner')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const dest = join(dir, 'kai-planner-mcp.mjs')
  const local = join(HERE, 'kai-planner-mcp.mjs')
  if (existsSync(local)) {
    copyFileSync(local, dest)
  } else if (!existsSync(dest)) {
    console.error(
      'ERROR: kai-planner-mcp.mjs not found next to this installer and no prior copy exists.\n' +
        'Download it first:\n' +
        '  curl -fsSL https://raw.githubusercontent.com/pikalover6/kaihoward/main/mcp/kai-planner-mcp.mjs -o kai-planner-mcp.mjs',
    )
    process.exit(1)
  }
  return dest
}

const serverPath = stableServerPath()
const configPath = claudeConfigPath()

// Load existing config (or start fresh) and merge our server in, preserving others.
let config = {}
if (existsSync(configPath)) {
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch (err) {
    console.error(`WARNING: existing config at ${configPath} is not valid JSON (${err.message}). Backing it up.`)
    copyFileSync(configPath, configPath + '.bak')
    config = {}
  }
}
if (!config.mcpServers || typeof config.mcpServers !== 'object') config.mcpServers = {}

const env = { KAI_BASE_URL: baseUrl, KAI_API_KEY: apiKey }
if (cfId && cfSecret) {
  env.CF_ACCESS_CLIENT_ID = cfId
  env.CF_ACCESS_CLIENT_SECRET = cfSecret
}

config.mcpServers['kai-planner'] = {
  command: process.execPath, // absolute path to this Node — most robust on Windows/macOS
  args: [serverPath],
  env,
}

mkdirSync(dirname(configPath), { recursive: true })
writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')

console.log('✅ kai-planner connector installed.')
console.log('   server : ' + serverPath)
console.log('   config : ' + configPath)
console.log('   node   : ' + process.execPath)
console.log('   access : ' + (cfId && cfSecret ? 'Cloudflare Access service token configured' : 'API key only (no CF Access token)'))
console.log('\nNext: fully quit and reopen Claude Desktop, then ask it "what\'s on my planner today?"')
console.log('\nTo also use it from the Claude Code CLI, run:')
console.log(
  `  claude mcp add kai-planner -s user -e KAI_BASE_URL=${baseUrl} -e KAI_API_KEY=*** ` +
    (cfId ? '-e CF_ACCESS_CLIENT_ID=*** -e CF_ACCESS_CLIENT_SECRET=*** ' : '') +
    `-- node "${serverPath}"`,
)
