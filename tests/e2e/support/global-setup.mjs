import { setConfiguration, TEST_CONFIGURATION } from './box.mjs';

export default async function globalSetup() {
    setConfiguration(TEST_CONFIGURATION);
}
