<?php

namespace Photobooth\Utility;

class LoginMenuUtility
{
    public static function isMenuSessionActive(array $session): bool
    {
        return ($session['auth'] ?? false) === true || !empty($session['rental']);
    }
}
