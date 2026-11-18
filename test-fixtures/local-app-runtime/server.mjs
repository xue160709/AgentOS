import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const host = process.env.HOST || '127.0.0.1'
const port = Number(process.env.PORT || 0)

function fixtureMode() {
  try {
    return fs.readFileSync(path.join(process.cwd(), '.fixture-mode'), 'utf8').trim().toLowerCase()
  } catch {
    return ''
  }
}

const mode = fixtureMode()

if (mode === 'fail') {
  process.stderr.write('Local App Runtime fixture mode=fail: intentional startup failure\n')
  process.exit(42)
}

let heartbeat
let stopping = false

function stopWithoutServer() {
  if (stopping) return
  stopping = true
  if (heartbeat) clearInterval(heartbeat)
  process.exit(0)
}

if (mode === 'slow') {
  console.log('Local App Runtime fixture mode=slow: waiting without listening')
  // Keep a real handle so the fixture remains alive while readiness probes
  // time out.  Signal handlers below make termination deterministic.
  heartbeat = setInterval(() => {}, 1000)
  process.once('SIGTERM', stopWithoutServer)
  process.once('SIGINT', stopWithoutServer)
} else {
  const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Local App Fixture</title>
    <style>
      :root { color-scheme: light dark; font: 15px/1.45 system-ui, sans-serif; }
      body { margin: 0; padding: 24px; }
      main { display: grid; gap: 14px; max-width: 720px; }
      section { border: 1px solid currentColor; border-radius: 8px; padding: 12px; }
      dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 8px 0 0; }
      dt { font-weight: 600; }
      dd { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      .actions { display: flex; flex-wrap: wrap; gap: 8px; }
      button { font: inherit; padding: 7px 10px; }
      output { display: block; min-height: 1.45em; margin-top: 8px; }
    </style>
  </head>
  <body>
    <main data-fixture="local-app-runtime">
      <h1>Local App Runtime fixture</h1>
      <p data-testid="fixture-description">This page is served locally and does not load external resources.</p>
      <section aria-labelledby="fixture-runtime-title">
        <h2 id="fixture-runtime-title">Preview bridge surface</h2>
        <dl>
          <dt>typeof window.desktop</dt>
          <dd data-testid="fixture-window-desktop" id="fixture-window-desktop"></dd>
          <dt>typeof window.require</dt>
          <dd data-testid="fixture-window-require" id="fixture-window-require"></dd>
          <dt>typeof window.process</dt>
          <dd data-testid="fixture-window-process" id="fixture-window-process"></dd>
        </dl>
      </section>
      <section aria-labelledby="fixture-security-title">
        <h2 id="fixture-security-title">Preview security checks</h2>
        <div class="actions">
          <button type="button" data-testid="fixture-window-open" id="fixture-window-open">Test window.open</button>
          <button type="button" data-testid="fixture-top-navigation" id="fixture-top-navigation">Test external top navigation</button>
          <button type="button" data-testid="fixture-geolocation" id="fixture-geolocation">Request geolocation permission</button>
        </div>
        <output data-testid="fixture-window-open-result" id="fixture-window-open-result" role="status" aria-live="polite"></output>
        <output data-testid="fixture-top-navigation-result" id="fixture-top-navigation-result" role="status" aria-live="polite"></output>
        <output data-testid="fixture-geolocation-result" id="fixture-geolocation-result" role="status" aria-live="polite"></output>
      </section>
    </main>
    <script>
      (function () {
        function text(id, value) {
          var element = document.getElementById(id)
          if (element) element.textContent = value
        }

        text('fixture-window-desktop', typeof window.desktop)
        text('fixture-window-require', typeof window.require)
        text('fixture-window-process', typeof window.process)

        document.getElementById('fixture-window-open').addEventListener('click', function () {
          var result
          try {
            var opened = window.open('https://example.com', '_blank', 'noopener,noreferrer')
            result = opened ? 'window.open result: returned a Window' : 'window.open result: blocked or null'
          } catch (error) {
            result = 'window.open result: threw ' + (error && error.name ? error.name : 'Error')
          }
          text('fixture-window-open-result', result)
        })

        document.getElementById('fixture-top-navigation').addEventListener('click', function () {
          // Write the observable result before asking the host to navigate.
          // AgentOS should reject this cross-origin navigation; if a host ever
          // allows it, the page may leave without relying on the external site.
          text('fixture-top-navigation-result', 'top navigation result: attempted https://example.com')
          try {
            window.location.assign('https://example.com')
          } catch (error) {
            text('fixture-top-navigation-result', 'top navigation result: blocked with ' + (error && error.name ? error.name : 'Error'))
          }
        })

        document.getElementById('fixture-geolocation').addEventListener('click', function () {
          text('fixture-geolocation-result', 'geolocation permission: pending')
          if (!navigator.geolocation) {
            text('fixture-geolocation-result', 'geolocation permission: unavailable')
            return
          }
          try {
            navigator.geolocation.getCurrentPosition(
              function () { text('fixture-geolocation-result', 'geolocation permission: granted') },
              function (error) {
                text('fixture-geolocation-result', 'geolocation permission: denied or failed (' + (error && error.code != null ? error.code : 'unknown') + ')')
              },
              { timeout: 1500, maximumAge: 0 },
            )
          } catch (error) {
            text('fixture-geolocation-result', 'geolocation permission: blocked with ' + (error && error.name ? error.name : 'Error'))
          }
        })
      })()
    </script>
  </body>
</html>`

  const server = http.createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('ok')
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(page)
  })

  const stop = () => {
    if (stopping) return
    stopping = true
    server.close(() => process.exit(0))
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)

  server.listen(port, host, () => {
    const address = server.address()
    const actualPort = typeof address === 'object' && address ? address.port : port
    console.log(`Local: http://localhost:${actualPort}/`)
  })
}
