// Ziffernblock für die PIN – am Touchscreen mit großen Tasten, am Laptop auch per Tastatur.
// Barrierefreiheit: echtes Eingabefeld mit Beschriftung, Tasten mit Namen, Fehlermeldung als Live-Region.

import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';

export const PIN_MAX_LENGTH = 12;

@Component({
    selector: 'sn-pin-pad',
    template: `
        <form (submit)="$event.preventDefault(); submit()" autocomplete="off">
            <label class="visually-hidden" for="pin">PIN</label>
            <input
                id="pin"
                name="pin"
                type="password"
                inputmode="numeric"
                pattern="[0-9]*"
                [attr.maxlength]="maxLength"
                [value]="pin()"
                (input)="typed($any($event.target).value)"
                [disabled]="busy()"
                [attr.aria-describedby]="message() ? 'pin-message' : null"
                autofocus
            />
            <div class="keys" role="group" aria-label="Ziffernblock">
                @for (digit of digits; track digit) {
                    <button type="button" (click)="press(digit)" [disabled]="busy()">{{ digit }}</button>
                }
                <button type="button" (click)="erase()" [disabled]="busy()" aria-label="Letzte Ziffer löschen">⌫</button>
                <button type="button" (click)="press('0')" [disabled]="busy()">0</button>
                <button type="submit" class="primary" [disabled]="busy() || pin().length < 4">Anmelden</button>
            </div>
            <p id="pin-message" class="message" role="alert" aria-live="assertive">{{ message() }}</p>
        </form>
    `,
    styles: `
        input {
            width: 100%;
            font-size: 2rem;
            letter-spacing: 0.5rem;
            text-align: center;
            padding: 0.5rem;
            border: 2px solid var(--line-strong);
            border-radius: var(--radius);
        }
        .keys {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 0.75rem;
            margin-top: 1.25rem;
        }
        .keys button {
            min-height: 3.75rem;
            padding: 0;
            font-size: 1.5rem;
        }
        .keys .primary {
            font-size: 1rem;
        }
        .message {
            min-height: 1.5rem;
            margin: 1rem 0 0;
            color: var(--danger);
            font-weight: 600;
            text-align: center;
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PinPad {
    readonly busy = input(false);
    readonly message = input('');
    readonly entered = output<string>();

    protected readonly digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
    protected readonly maxLength = PIN_MAX_LENGTH;
    protected readonly pin = signal('');

    protected press(digit: string): void {
        if (this.pin().length < PIN_MAX_LENGTH) this.pin.update((pin) => pin + digit);
    }

    protected erase(): void {
        this.pin.update((pin) => pin.slice(0, -1));
    }

    protected typed(value: string): void {
        this.pin.set(value.replace(/\D/g, '').slice(0, PIN_MAX_LENGTH));
    }

    protected submit(): void {
        const pin = this.pin();
        if (pin.length < 4 || this.busy()) return;
        // Die PIN bleibt nicht im Feld stehen, egal wie die Anmeldung ausgeht
        this.pin.set('');
        this.entered.emit(pin);
    }
}
