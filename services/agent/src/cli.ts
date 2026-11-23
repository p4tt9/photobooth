// Bedienung des Agents auf der Box:
//
//   docker compose exec agent snaphora-agent status
//   docker compose exec agent snaphora-agent sync
//   docker compose exec agent snaphora-agent register <token>

const base = `http://127.0.0.1:${process.env.PORT ?? 3001}`;
const [command, argument] = process.argv.slice(2);

async function call(method: string, path: string, body?: unknown): Promise<void> {
    const response = await fetch(base + path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    console.log(JSON.stringify(JSON.parse(text), null, 2));
    if (!response.ok) {
        process.exitCode = 1;
    }
}

switch (command) {
    case 'status':
        await call('GET', '/v1/status');
        break;
    case 'sync':
        await call('POST', '/v1/sync');
        break;
    case 'register':
        if (!argument) {
            console.error('Aufruf: snaphora-agent register <token>');
            process.exit(2);
        }
        await call('POST', '/v1/register', { token: argument });
        break;
    default:
        console.error('Befehle: status | sync | register <token>');
        process.exit(2);
}
