<?php

namespace Photobooth\Configuration\Section;

use Symfony\Component\Config\Definition\Builder\NodeDefinition;
use Symfony\Component\Config\Definition\Builder\TreeBuilder;

/**
 * Snaphora-Bildpipeline (Render-Dienst): Look, Anzeige sofort, Galerie- und Druckbild im Hintergrund.
 */
final class RenderConfiguration
{
    public static function getNode(): NodeDefinition
    {
        $node = (new TreeBuilder('render'))->getRootNode()->addDefaultsIfNotSet()->ignoreExtraKeys()->children();

        $node
            ->booleanNode('enabled')->defaultValue(true)->end()
            // Adresse des Render-Dienstes und unter der er die App erreicht (internes Docker-Netz)
            ->scalarNode('url')->defaultValue('http://render:3000')->end()
            ->scalarNode('app_url')->defaultValue('http://photobooth')->end()
            // Look (Ordnername im Look-Verzeichnis), leer = ohne Look
            ->scalarNode('look')->defaultValue('')->end();

        // Zahlen kommen aus der Admin-Oberfläche als Text
        $integers = [
            'display_size' => [1920, 640, 6000],
            'gallery_size' => [3000, 640, 8000],
            // DNP DS620, 4x6" bei 300 dpi
            'print_width' => [1844, 300, 10000],
            'print_height' => [1240, 300, 10000],
        ];
        foreach ($integers as $name => [$default, $min, $max]) {
            $node->integerNode($name)
                ->defaultValue($default)
                ->min($min)
                ->max($max)
                ->beforeNormalization()
                    ->ifString()
                    ->then(fn (string $value): int => intval($value))
                    ->end()
                ->end();
        }

        return $node->end();
    }
}
