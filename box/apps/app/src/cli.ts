// Werkzeuge für Provisionierung und Wartung:
//   snaphora-app hash-pin      liest eine PIN von stdin und gibt den Hash für ADMIN_PIN_HASH aus
import { PIN_PATTERN } from '@snaphora/contracts';
import { hashPin } from './access/pin.js';

const [command] = process.argv.slice(2);

if (command === 'hash-pin') {
    let input = '';
    for await (const chunk of process.stdin) {
        input += String(chunk);
    }
    const pin = input.trim();
    if (!PIN_PATTERN.test(pin)) {
        console.error('PIN muss aus 4 bis 12 Ziffern bestehen');
        process.exit(1);
    }
    console.log(await hashPin(pin));
} else {
    console.error('Befehle: hash-pin (PIN über stdin)');
    process.exit(1);
}
