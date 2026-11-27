// fetch für Tests gegen die Dev-Umgebung.
//
// Apache schließt wiederverwendete Verbindungen nach kurzer Leerlaufzeit. Trifft eine Anfrage genau diesen Moment,
// meldet Node „other side closed“ (UND_ERR_SOCKET). Die Anfragen der Tests dürfen wiederholt werden, deshalb wird in
// diesem einen Fall einmal neu gesendet – jeder andere Fehler bleibt ein Fehler.

export async function fetchRetry(url, options = {}) {
    try {
        return await fetch(url, options);
    } catch (error) {
        if (error?.cause?.code !== 'UND_ERR_SOCKET') {
            throw error;
        }
        return fetch(url, options);
    }
}
