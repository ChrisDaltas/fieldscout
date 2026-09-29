/**
 * sim-keepalive-fetch.test.ts — M5 L.D3.10 (F375, D423). The season sim's
 * local transport keeps its connections through a server that closes every
 * connection after 100 requests (Kong's keep-alive limit, reproduced with
 * `server.maxRequestsPerSocket = 100`), and speaks enough `fetch` for
 * supabase-js: status / headers / text / json, a request body, HEAD and 204
 * with no body, an abort, and a transport error shaped like fetch's.
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { keepAliveFetch } from './sim-keepalive-fetch'

let server: http.Server
let base = ''
let connections = 0

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      if (req.url === '/empty') {
        res.writeHead(204)
        res.end()
        return
      }
      if (req.url === '/slow') {
        setTimeout(() => res.end('late'), 2_000)
        return
      }
      res.setHeader('content-type', 'application/json')
      res.setHeader('x-multi', ['a', 'b'])
      res.end(JSON.stringify({ method: req.method, body: Buffer.concat(chunks).toString('utf8'), auth: req.headers.authorization ?? null }))
    })
  })
  server.maxRequestsPerSocket = 100
  server.on('connection', () => {
    connections += 1
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('keepAliveFetch', () => {
  it('reuses its connections through a server that closes each one after 100 requests', async () => {
    const before = connections
    for (let i = 0; i < 1000; i++) {
      const res = await keepAliveFetch(`${base}/x?i=${i}`)
      expect(res.status).toBe(200)
      await res.text()
    }
    // 1000 requests / 100 per connection = 10 connections (+ slack for the
    // pool's timing); the global fetch on Node 24.14 measured ~800 here.
    expect(connections - before).toBeLessThanOrEqual(12)
  })

  it('carries method, headers and a body, and answers like fetch', async () => {
    const res = await keepAliveFetch(`${base}/echo`, {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    })
    expect(res.ok).toBe(true)
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(res.headers.get('x-multi')).toBe('a, b')
    expect(await res.json()).toEqual({ method: 'POST', body: '{"a":1}', auth: 'Bearer t' })
  })

  it('gives HEAD and 204 no body', async () => {
    const head = await keepAliveFetch(`${base}/x`, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.body).toBeNull()
    const empty = await keepAliveFetch(`${base}/empty`)
    expect(empty.status).toBe(204)
    expect(await empty.text()).toBe('')
  })

  it('aborts on its signal and rejects a dead host like fetch does', async () => {
    const controller = new AbortController()
    const pending = keepAliveFetch(`${base}/slow`, { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await expect(keepAliveFetch('http://127.0.0.1:1/x')).rejects.toMatchObject({ name: 'TypeError', message: 'fetch failed' })
  })
})
