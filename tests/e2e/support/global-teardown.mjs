import { resetConfiguration } from './box.mjs';

export default async function globalTeardown() {
    if (!process.env.KEEP_CONFIG) {
        resetConfiguration();
    }
}
