// Zustandsanzeige: nie nur über Farbe – immer mit Symbol und Text (Barrierefreiheit, auch bei Sonnenlicht).

import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type Level = 'ok' | 'warn' | 'error';

const SYMBOL: Record<Level, string> = { ok: '✓', warn: '!', error: '✕' };
const LABEL: Record<Level, string> = { ok: 'In Ordnung', warn: 'Hinweis', error: 'Fehler' };

@Component({
    selector: 'sn-state',
    template: `<span class="state" [class]="level()"><span aria-hidden="true" class="symbol">{{ symbol[level()] }}</span><span class="visually-hidden">{{ label[level()] }}: </span><ng-content /></span>`,
    styles: `
        .state {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            font-weight: 600;
        }
        .symbol {
            display: inline-grid;
            place-items: center;
            width: 1.5rem;
            height: 1.5rem;
            border-radius: 50%;
            color: #fff;
            font-size: 0.9rem;
        }
        .ok .symbol {
            background: var(--ok);
        }
        .warn .symbol {
            background: var(--warn);
            color: #1a1a1a;
        }
        .error .symbol {
            background: var(--danger);
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class State {
    readonly level = input.required<Level>();
    protected readonly symbol = SYMBOL;
    protected readonly label = LABEL;
}
