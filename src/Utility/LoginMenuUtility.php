<?php

namespace Photobooth\Utility;

class LoginMenuUtility
{
    public static function isMenuSessionActive(array $session): bool
    {
        // $_SESSION['auth'] is derived from the PIN session of app (AppAccessService)
        return ($session['auth'] ?? false) === true;
    }
}
