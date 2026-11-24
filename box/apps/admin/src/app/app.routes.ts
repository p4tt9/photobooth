import type { Routes } from '@angular/router';
import { requireRole } from './core/guards';

// Seiten werden erst geladen, wenn man sie öffnet (kleiner Start am Kiosk)
export const routes: Routes = [
    { path: 'anmelden', title: 'Anmelden – Snaphora', loadComponent: () => import('./pages/login').then((m) => m.Login) },
    {
        path: '',
        canActivate: [requireRole('setup')],
        loadComponent: () => import('./pages/shell').then((m) => m.Shell),
        children: [
            { path: '', title: 'Übersicht – Snaphora', loadComponent: () => import('./pages/overview').then((m) => m.Overview) },
            { path: 'druck', title: 'Druckkontingent – Snaphora', loadComponent: () => import('./pages/print').then((m) => m.Print) },
            { path: 'event', title: 'Event – Snaphora', loadComponent: () => import('./pages/event').then((m) => m.Event) },
            { path: 'einstellungen/:section', title: 'Einstellungen – Snaphora', loadComponent: () => import('./pages/settings').then((m) => m.Settings) },
            { path: 'bibliothek', title: 'Bilder und Schriften – Snaphora', loadComponent: () => import('./pages/library').then((m) => m.Library) },
            { path: 'zugang', title: 'Zugang – Snaphora', canActivate: [requireRole('admin')], loadComponent: () => import('./pages/access').then((m) => m.Access) },
            { path: 'wartung', title: 'Wartung – Snaphora', loadComponent: () => import('./pages/maintenance').then((m) => m.Maintenance) },
        ],
    },
    { path: '**', redirectTo: '' },
];
