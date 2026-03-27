/**
 * Next.js CLI blocks port 6000 (WHATWG “bad ports”). We bind HTTP on 6000
 * and hand off to Next’s request handler so http://localhost:6000 works in dev.
 */
const { createServer } = require('http')
const { parse } = require('url')
const next = require('next')

const port = Number(process.env.PORT || 6000)
const dev = process.env.NODE_ENV !== 'production'

const app = next({ dev })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  createServer((req, res) => {
    const parsedUrl = parse(req.url, true)
    handle(req, res, parsedUrl)
  }).listen(port, '0.0.0.0', (err) => {
    if (err) throw err
    console.log(`> Ready on http://localhost:${port}`)
  })
})
