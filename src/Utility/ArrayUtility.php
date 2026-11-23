<?php

namespace Photobooth\Utility;

class ArrayUtility
{
    public static function mergeRecursive(array $array, array $overrule): array
    {
        foreach ($overrule as $key => $overruleValue) {
            if (isset($array[$key]) && is_array($array[$key]) && is_array($overruleValue)) {
                $array[$key] = self::mergeRecursive($array[$key], $overruleValue);
            } else {
                $array[$key] = $overruleValue;
            }
        }
        reset($array);

        return $array;
    }

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

    /**
     * $array without the paths that exist in $mask.
     */
    public static function removePaths(array $array, array $mask): array
    {
        foreach ($mask as $key => $maskValue) {
            if (!array_key_exists($key, $array)) {
                continue;
            }
            if (is_array($maskValue) && !array_is_list($maskValue) && $maskValue !== [] && is_array($array[$key])) {
                $array[$key] = self::removePaths($array[$key], $maskValue);
                if ($array[$key] === []) {
                    unset($array[$key]);
                }
            } else {
                unset($array[$key]);
            }
        }

        return $array;
    }

    public static function setValueByPath(array $array, string $path, mixed $value): array
    {
        $delimiter = '/';
        if ($path === '') {
            throw new \RuntimeException('Path must not be empty', 1695053538);
        }

        /** @var string[] */
        $data = str_getcsv($path, $delimiter);
        $pointer = &$array;
        foreach ($data as $segment) {
            if ($segment === '') {
                throw new \RuntimeException('Invalid path segment specified', 1341406846);
            }
            if (is_array($pointer) && !array_key_exists($segment, $pointer)) {
                $pointer[$segment] = [];
            }
            if (!is_array($pointer)) {
                $pointer = [];
            }
            $pointer = &$pointer[$segment];
        }
        $pointer = $value;

        return $array;
    }

    public static function getValueByPath(array $array, string $path): mixed
    {
        $delimiter = '/';
        if ($path === '') {
            throw new \RuntimeException('Path must not be empty', 1695053537);
        }

        /** @var string[] */
        $data = str_getcsv($path, $delimiter);
        $value = $array;
        foreach ($data as $segment) {
            if (is_array($value) && array_key_exists($segment, $value)) {
                $value = $value[$segment];
            } else {
                throw new \RuntimeException('Segment ' . $segment . ' of path ' . implode($delimiter, $data) . ' does not exist in array', 1695053538);
            }
        }

        return $value;
    }

    public static function diffRecursive(array $array1, array $array2): array
    {
        $differenceArray = [];
        foreach ($array1 as $key => $value) {
            if (!array_key_exists($key, $array2) || (!is_array($value) && $value !== $array2[$key])) {
                $differenceArray[$key] = $value;
            } elseif (is_array($value)) {
                if (is_array($array2[$key])) {
                    $recursiveResult = self::diffRecursive($value, $array2[$key]);
                    if (!empty($recursiveResult)) {
                        $differenceArray[$key] = $recursiveResult;
                    }
                }
            }
        }
        return $differenceArray;
    }

    public static function export(array $array = [], int $level = 0): string
    {
        $output = "[\n";
        $level++;
        $writeKeyIndex = false;
        $expectedKeyIndex = 0;
        foreach ($array as $key => $value) {
            if ($key === $expectedKeyIndex) {
                $expectedKeyIndex++;
            } else {
                $writeKeyIndex = true;
                break;
            }
        }
        foreach ($array as $key => $value) {
            $output .= str_repeat('    ', $level);
            if ($writeKeyIndex) {
                $output .= is_int($key) ? $key . ' => ' : '\'' . $key . '\' => ';
            }
            if (is_array($value)) {
                if (!empty($value)) {
                    $output .= self::export($value, $level);
                } else {
                    $output .= "[],\n";
                }
            } elseif (is_int($value) || is_float($value)) {
                $output .= $value . ",\n";
            } elseif ($value === null) {
                $output .= "null,\n";
            } elseif (is_bool($value)) {
                $output .= $value ? 'true' : 'false';
                $output .= ",\n";
            } elseif (is_string($value)) {
                $stringContent = str_replace(['\\', '\''], ['\\\\', '\\\''], $value);
                $output .= '\'' . $stringContent . "',\n";
            } elseif ($value instanceof \BackedEnum) {
                $value = $value->value;
                if (is_string($value)) {
                    $stringContent = str_replace(['\\', '\''], ['\\\\', '\\\''], $value);
                    $output .= '\'' . $stringContent . "',\n";
                } else {
                    $output .= $value . ",\n";
                }
            } else {
                throw new \RuntimeException('Objects are not supported');
            }
        }

        $output .= str_repeat('    ', $level - 1) . ']' . ($level - 1 == 0 ? '' : ",\n");
        return $output;
    }

    public static function replaceBooleanValues(array $array): array
    {
        $result = [];
        foreach ($array as $key => $value) {
            if (is_array($value)) {
                $result[$key] = self::replaceBooleanValues($value);
            } else {
                if ($value === 'true') {
                    $result[$key] = true;
                } elseif ($value === 'false') {
                    $result[$key] = false;
                } else {
                    $result[$key] = $value;
                }
            }
        }
        return $result;
    }
}
