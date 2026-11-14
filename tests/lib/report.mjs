// Fehlerausgabe für Tests. Unter GitHub Actions werden Fehler zusätzlich als Annotation ausgegeben:
// Die steht auf der Übersichtsseite des Laufs und ist – anders als das Protokoll – ohne Anmeldung lesbar.

const onGitHub = process.env.GITHUB_ACTIONS === 'true';

function escapeAnnotation(text) {
    return String(text).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

export function reportError(title, message) {
    if (onGitHub) {
        console.log(`::error title=${escapeAnnotation(title)}::${escapeAnnotation(message)}`);
    }
}

/**
 * Führt einen Test aus und meldet unerwartete Fehler mit Stacktrace.
 */
export async function runTest(title, main) {
    try {
        await main();
    } catch (error) {
        console.error(error);
        const cause = error?.cause ? `\nUrsache: ${error.cause.code ?? ''} ${error.cause.message ?? error.cause}` : '';
        reportError(title, (error?.stack ?? String(error)) + cause);
        process.exit(1);
    }
}
