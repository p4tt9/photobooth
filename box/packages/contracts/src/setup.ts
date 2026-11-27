// Selbsttest und Aufbau-Checkliste (Konzept 4.9).
//
// Die Checkliste kommt mit dem Event vom Server (Vorlage am Paket). Beim Aufbau läuft der Selbsttest, die
// angemeldete Person hakt die Punkte ab, und das Ergebnis geht als Aufbau-Bericht an den Server.
//
//   config/checklist.json   Checkliste des Events – schreibt der Agent, liest app
//   Aufbau-Bericht          app → Agent (lokal) → Server, stromausfallsicher in der Warteschlange des Agents

export type CheckLevel = 'ok' | 'warn' | 'error';

/** Ergebnis einer automatischen Prüfung */
export interface SelftestCheck {
    id: string;
    label: string;
    level: CheckLevel;
    message: string;
}

export interface ChecklistItem {
    itemId: string;
    text: string;
    /** Muss abgehakt sein; sonst braucht der Abschluss eine Bemerkung */
    required: boolean;
}

export interface Checklist {
    checklistId: string;
    version: number;
    name: string;
    items: ChecklistItem[];
}

/** config/checklist.json */
export interface ChecklistFile {
    eventId: string;
    validFrom: string;
    validUntil: string;
    checklist: Checklist;
}

export const CHECKLIST_FILE = 'checklist.json';

export interface SelftestRun {
    runId: string;
    startedAt: string;
    checks: SelftestCheck[];
    /** Testfoto, falls aufgenommen: Adresse zur Ansicht */
    testPhoto: string | null;
}

/** Aufbau-Bericht: geht an den Server (Vertrag: PUT /device/v1/setup-reports/{reportId}) */
export interface SetupReport {
    reportId: string;
    eventId: string | null;
    checklistId: string | null;
    checklistVersion: number | null;
    personId: string;
    personName: string;
    startedAt: string;
    completedAt: string;
    /** schlechtestes Ergebnis über alle Prüfungen und Punkte */
    result: CheckLevel;
    checks: SelftestCheck[];
    items: Array<{ itemId: string; text: string; required: boolean; done: boolean }>;
    note: string | null;
}

export const worstLevel = (levels: CheckLevel[]): CheckLevel => (levels.includes('error') ? 'error' : levels.includes('warn') ? 'warn' : 'ok');

export const REPORT_ID = /^[A-Za-z0-9_-]{8,64}$/;
