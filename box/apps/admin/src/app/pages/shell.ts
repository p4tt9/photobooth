// Rahmen der Verwaltung: Kopf mit angemeldeter Person, Navigation, Inhalt.
// Breit (Laptop, Touchscreen quer): Navigation links. Schmal (Handy): Navigation oben, waagerecht scrollbar.

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SETTING_SECTIONS } from '@snaphora/contracts';
import { Session } from '../core/session';

interface NavItem {
    link: string;
    label: string;
    adminOnly?: boolean;
}

@Component({
    selector: 'sn-shell',
    imports: [RouterOutlet, RouterLink, RouterLinkActive],
    template: `
        <a class="skip" href="#inhalt">Zum Inhalt springen</a>
        <header>
            <strong class="brand">Snaphora · Verwaltung</strong>
            @if (session.person(); as person) {
                <span class="person">{{ person.name }} · {{ person.role === 'admin' ? 'Admin' : 'Aufbau' }}</span>
            }
            <button type="button" class="secondary" (click)="logout()">Abmelden</button>
        </header>
        <div class="layout">
            <nav aria-label="Bereiche">
                <ul>
                    @for (item of main(); track item.link) {
                        <li>
                            <a [routerLink]="item.link" routerLinkActive="active" ariaCurrentWhenActive="page" [routerLinkActiveOptions]="{ exact: item.link === '/' }">{{
                                item.label
                            }}</a>
                        </li>
                    }
                    <li class="group">
                        <span id="nav-settings" class="group-title">Einstellungen</span>
                        <ul aria-labelledby="nav-settings">
                            @for (item of sections; track item.link) {
                                <li>
                                    <a [routerLink]="item.link" routerLinkActive="active" ariaCurrentWhenActive="page">{{ item.label }}</a>
                                </li>
                            }
                        </ul>
                    </li>
                    @for (item of tail(); track item.link) {
                        <li>
                            <a [routerLink]="item.link" routerLinkActive="active" ariaCurrentWhenActive="page">{{ item.label }}</a>
                        </li>
                    }
                </ul>
            </nav>
            <main id="inhalt" tabindex="-1">
                <router-outlet />
            </main>
        </div>
    `,
    styles: `
        :host {
            display: flex;
            flex-direction: column;
            min-height: 100dvh;
        }
        .skip {
            position: absolute;
            left: -999px;
        }
        .skip:focus {
            left: 1rem;
            top: 1rem;
            z-index: 10;
            background: var(--surface);
            padding: 0.75rem 1rem;
        }
        header {
            display: flex;
            align-items: center;
            gap: 1rem;
            padding: 0.75rem 1rem;
            background: var(--brand);
            color: var(--on-brand);
        }
        .brand {
            margin-right: auto;
        }
        .person {
            font-size: 0.95rem;
        }
        header button {
            background: transparent;
            color: var(--on-brand);
            border-color: var(--on-brand);
        }
        .layout {
            display: flex;
            flex: 1;
        }
        nav {
            width: 15rem;
            flex-shrink: 0;
            background: var(--surface);
            border-right: 1px solid var(--line);
        }
        nav ul {
            list-style: none;
            margin: 0;
            padding: 0.5rem;
        }
        nav a {
            display: flex;
            align-items: center;
            min-height: var(--touch);
            padding: 0 1rem;
            border-radius: var(--radius);
            color: var(--text);
            text-decoration: none;
        }
        .group-title {
            display: block;
            padding: 0.75rem 1rem 0.25rem;
            font-size: 0.85rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: var(--muted);
        }
        .group ul {
            padding: 0 0 0 0.5rem;
        }
        nav a.active {
            background: var(--brand-soft);
            color: var(--brand);
            font-weight: 600;
        }
        main {
            flex: 1;
            padding: 1.5rem;
            min-width: 0;
        }
        @media (max-width: 47.99rem) {
            .layout {
                flex-direction: column;
            }
            nav {
                width: auto;
                border-right: 0;
                border-bottom: 1px solid var(--line);
                overflow-x: auto;
            }
            nav ul {
                display: flex;
                gap: 0.25rem;
            }
            .group {
                display: flex;
                align-items: center;
            }
            .group-title {
                padding: 0 0.5rem;
            }
            .group ul {
                padding: 0;
            }
            nav a {
                white-space: nowrap;
            }
            main {
                padding: 1rem;
            }
            .person {
                display: none;
            }
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Shell {
    protected readonly session = inject(Session);

    protected readonly main = computed<NavItem[]>(() => [
        { link: '/', label: 'Übersicht' },
        { link: '/druck', label: 'Kontingent' },
        { link: '/event', label: 'Event' },
    ]);
    protected readonly sections: NavItem[] = Object.entries(SETTING_SECTIONS).map(([section, label]) => ({ link: `/einstellungen/${section}`, label }));
    protected readonly tail = computed<NavItem[]>(() =>
        [
            { link: '/zugang', label: 'Zugang', adminOnly: true },
            { link: '/wartung', label: 'Wartung' },
        ].filter((item) => !item.adminOnly || this.session.allows('admin')),
    );

    protected logout(): void {
        void this.session.logout(true);
    }
}
