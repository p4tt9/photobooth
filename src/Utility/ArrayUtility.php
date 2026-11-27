<?php

namespace Photobooth\Utility;

class ArrayUtility
{
    /**
     * Lays $layer over $base: nested settings are merged, lists (e.g. enabled layouts) and values are replaced.
     */
    public static function replaceLayer(array $base, array $layer): array
    {
        foreach ($layer as $key => $value) {
            if (is_array($value) && !array_is_list($value) && isset($base[$key]) && is_array($base[$key]) && !array_is_list($base[$key])) {
                $base[$key] = self::replaceLayer($base[$key], $value);
            } else {
                $base[$key] = $value;
            }
        }

        return $base;
    }

    /**
     * Part of $array at the paths that exist in $mask (lists and values of $mask count as leaves).
     */
    public static function intersectPaths(array $array, array $mask): array
    {
        $result = [];
        foreach ($mask as $key => $maskValue) {
            if (!array_key_exists($key, $array)) {
                continue;
            }
            if (is_array($maskValue) && !array_is_list($maskValue) && $maskValue !== [] && is_array($array[$key])) {
                $nested = self::intersectPaths($array[$key], $maskValue);
                if ($nested !== []) {
                    $result[$key] = $nested;
                }
            } else {
                $result[$key] = $array[$key];
            }
        }

        return $result;
    }
}
