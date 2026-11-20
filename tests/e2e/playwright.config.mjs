import { defineConfig, devices } from '@playwright/test';

// Läuft gegen die Dev-Umgebung (docker compose up). Die Tests teilen sich eine Box,
// daher nacheinander statt parallel.
export default defineConfig({
    testDir: './specs',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 120_000,
    expect: { timeout: 30_000 },
    reporter: process.env.CI ? [['list'], ['github']] : [['list']],
    globalSetup: './support/global-setup.mjs',
    globalTeardown: './support/global-teardown.mjs',
    use: {
        baseURL: process.env.BASE_URL ?? 'http://localhost:8080',
        ...devices['Desktop Chrome'],
        // Lokal kann das installierte Chrome genutzt werden: PW_CHANNEL=chrome npm test
        channel: process.env.PW_CHANNEL || undefined,
        // Ungefähr der Touchscreen der Box (Querformat)
        viewport: { width: 1280, height: 800 },
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
});
