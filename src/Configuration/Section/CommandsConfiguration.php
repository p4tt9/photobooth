<?php

namespace Photobooth\Configuration\Section;

use Symfony\Component\Config\Definition\Builder\NodeDefinition;
use Symfony\Component\Config\Definition\Builder\TreeBuilder;

final class CommandsConfiguration
{
    public static function getNode(): NodeDefinition
    {
        // Die Fotobox läuft ausschließlich unter Linux (Container auf dem ThinkCentre).
        $defaults = [
            'take_picture'  => 'gphoto2 --capture-image-and-download --filename=%s',
            'take_collage'  => '',
            'take_custom'   => '',
            'print'         => 'lp -o landscape -o fit-to-page %s',
            'exiftool'      => 'exiftool -overwrite_original -TagsFromFile %s %s',
            'nodebin'       => '/usr/bin/node',
            'reboot'        => '/sbin/shutdown -r now',
            'shutdown'      => '/sbin/shutdown -h now',
            'preview'       => '',
            'preview_kill'  => '',
            'pre_photo'     => '',
            'post_photo'    => '',
        ];

        return (new TreeBuilder('commands'))
            ->getRootNode()
            ->addDefaultsIfNotSet()
            ->ignoreExtraKeys()
            ->children()
                ->scalarNode('take_picture')->defaultValue($defaults['take_picture'])->end()
                ->scalarNode('take_collage')->defaultValue($defaults['take_collage'])->end()
                ->scalarNode('take_custom')->defaultValue($defaults['take_custom'])->end()
                ->scalarNode('print')->defaultValue($defaults['print'])->end()
                ->scalarNode('exiftool')->defaultValue($defaults['exiftool'])->end()
                ->scalarNode('preview')->defaultValue($defaults['preview'])->end()
                ->scalarNode('preview_kill')->defaultValue($defaults['preview_kill'])->end()
                ->scalarNode('nodebin')->defaultValue($defaults['nodebin'])->end()
                ->scalarNode('pre_photo')->defaultValue($defaults['pre_photo'])->end()
                ->scalarNode('post_photo')->defaultValue($defaults['post_photo'])->end()
                ->scalarNode('reboot')->defaultValue($defaults['reboot'])->end()
                ->scalarNode('shutdown')->defaultValue($defaults['shutdown'])->end()
            ->end();
    }
}
