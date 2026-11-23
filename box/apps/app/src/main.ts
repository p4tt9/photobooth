// Start von app (planning/ARCHITEKTUR.md).
import { createApp } from './create-app.js';
import { environmentFromProcess } from './environment.js';

const environment = environmentFromProcess();
const app = await createApp(environment);
await app.listen(environment.port, environment.host);
console.log(`Snaphora app ${environment.appVersion} hört auf ${environment.host}:${environment.port}`);
