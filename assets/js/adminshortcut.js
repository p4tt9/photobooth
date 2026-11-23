// Versteckter Zugang zur Verwaltung: 5× in die Ecke tippen, innerhalb von 3 Sekunden (Konzept 4.5).
(function () {
    const corner = document.querySelector('.adminshortcut');
    if (!corner) {
        return;
    }
    const required = 5;
    const windowMs = 3000;
    let taps = [];

    corner.addEventListener('pointerdown', function (event) {
        event.preventDefault();
        const now = Date.now();
        taps = taps.filter((time) => now - time < windowMs);
        taps.push(now);
        if (taps.length >= required) {
            taps = [];
            window.location.href = corner.dataset.target;
        }
    });
})();
