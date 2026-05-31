#!/usr/bin/env node
/**
 * End-to-end smoke test for the kai-planner MCP server.
 *
 * Spawns kai-planner-mcp.mjs, performs the MCP handshake, then exercises a full
 * lifecycle against the LIVE API: overview -> create -> verify in list ->
 * schedule -> verify in schedule -> complete -> delete -> verify gone.
 * It cleans up after itself (deletes the goal it creates).
 *
 * Run from the mcp/ folder with the same env vars the connector uses:
 *   KAI_API_KEY=...  CF_ACCESS_CLIENT_ID=...  CF_ACCESS_CLIENT_SECRET=...  node smoke-test.mjs
 *
 * Exits 0 on success, 1 on any failure.
 */

import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER = join(HERE, 'kai-planner-mcp.mjs')

const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'inherit'], env: process.env })

let nextId = 1
const pending = new Map()
let buf = ''
child.stdout.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  buf += chunk
  let nl
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (!line) continue
    let msg
    try { msg = JSON.parse(line) } catch { continue }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
})

function rpc(method, params) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, (msg) => (msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)))
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 20000)
  })
}

// tools/call returns { content:[{text}], isError? }. Unwrap the JSON text payload.
async function call(name, args = {}) {
  const res = await rpc('tools/call', { name, arguments: args })
  const text = res?.content?.[0]?.text ?? ''
  let data
  try { data = JSON.parse(text) } catch { data = text }
  if (res?.isError) throw new Error(`${name} failed: ${typeof data === 'string' ? data : JSON.stringify(data)}`)
  return data
}

let passed = 0
function ok(label, cond, extra = '') {
  if (cond) { console.log(`  PASS  ${label}`); passed++ }
  else { console.error(`  FAIL  ${label} ${extra}`); throw new Error(`assertion failed: ${label}`) }
}

function flatten(tree) {
  const out = []
  const walk = (nodes) => nodes.forEach((n) => { out.push(n); walk(n.children || []) })
  walk(tree)
  return out
}

async function main() {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } })
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  console.log('handshake ok')

  const overview = await call('get_overview')
  ok('get_overview returns totals', overview && overview.totals && typeof overview.totals.goals === 'number')

  const stamp = new Date().toISOString().slice(0, 16)
  const title = `__smoke_test__ ${stamp}`
  const created = (await call('create_goal', {
    title,
    description: 'temporary smoke-test node',
    priority: 2,
    startAt: `${stamp.slice(0, 10)}T09:00`,
    endAt: `${stamp.slice(0, 10)}T10:00`,
    dueDate: stamp.slice(0, 10),
  })).created
  ok('create_goal returns id', created && created.id, JSON.stringify(created))
  ok('create_goal kept startAt', created.startAt === `${stamp.slice(0, 10)}T09:00`, created.startAt)
  const id = created.id

  const tree = (await call('list_goals')).tree
  ok('new goal appears in list', flatten(tree).some((g) => g.id === id))

  const sched = await call('get_schedule', { from: stamp.slice(0, 10), to: stamp.slice(0, 10) })
  ok('new goal appears in schedule', sched.items.some((g) => g.id === id))

  const renamed = (await call('update_goal', { id, title: title + ' (edited)', priority: 5 })).updated
  ok('update_goal renames + reprioritizes', renamed.title.endsWith('(edited)') && renamed.priority === 5)

  const done = (await call('complete_goal', { id })).updated
  ok('complete_goal sets status done', done.status === 'done')

  const del = await call('delete_goal', { id })
  ok('delete_goal ok', del.ok === true && del.deletedIds.includes(id))

  const after = (await call('list_goals')).tree
  ok('goal is gone after delete', !flatten(after).some((g) => g.id === id))

  console.log(`\nALL ${passed} CHECKS PASSED ✅`)
}

main()
  .then(() => { child.stdin.end(); process.exit(0) })
  .catch((err) => { console.error('\nSMOKE TEST FAILED:', err.message); child.stdin.end(); process.exit(1) })
