// Ringlicht-Simulator: nimmt die GET-Aufrufe entgegen, die die Fotobox an den ESP schickt
// (z. B. /CNTDWNPHOTO beim Countdown-Start), und protokolliert sie.
//
//   GET /<beliebig>   → wird protokolliert, Antwort "OK"
//   GET /_log         → letzte Aufrufe als JSON (für Tests)
//   DELETE /_log      → Protokoll leeren

import http from 'node:http';

const port = Number(process.env.PORT ?? 8081);
const maxEntries = 200;
const log = [];

const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (url.pathname === '/_log') {
        if (req.method === 'DELETE') {
            log.length = 0;
            res.writeHead(204).end();
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(log));
        return;
    }

    const entry = { time: new Date().toISOString(), method: req.method, path: url.pathname };
    log.push(entry);
    if (log.length > maxEntries) {
        log.shift();
    }
    console.log(`${entry.time} Ringlicht: ${entry.method} ${entry.path}`);

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
});

server.listen(port, () => {
    console.log(`Ringlicht-Simulator läuft auf Port ${port}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
