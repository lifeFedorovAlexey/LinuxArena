import { createVisualBlockDefinitions, registerVisualExtensions } from '../../core/visual/language.mjs';
import { PLACEMENT_ADAPTER } from '../../core/placement/adapter.mjs';
import { defineLocalizedBlocks } from './localization.mjs';

export const Blockly = window.Blockly;
registerVisualExtensions(Blockly);
defineLocalizedBlocks(createVisualBlockDefinitions(PLACEMENT_ADAPTER));
const palette = (primary, secondary, tertiary) => ({
  colourPrimary: primary,
  colourSecondary: secondary,
  colourTertiary: tertiary,
});
const theme = Blockly.Theme.defineTheme('arena', {
  base: Blockly.Themes.Classic,
  blockStyles: {
    entry_blocks: palette('#3b6069', '#29464d', '#7eafb8'),
    data_blocks: palette('#3d6b55', '#2b4d3c', '#82ad8c'),
    math_blocks: palette('#52743a', '#3a5328', '#9fbd72'),
    condition_blocks: palette('#846c34', '#604d25', '#d0b46b'),
  },
  componentStyles: {
    workspaceBackgroundColour: '#141d1b',
    toolboxBackgroundColour: '#19231f',
    toolboxForegroundColour: '#c4d1c6',
    flyoutBackgroundColour: '#202c25',
    flyoutForegroundColour: '#dce7d7',
    flyoutOpacity: 1,
    scrollbarColour: '#4e6556',
    scrollbarOpacity: 0.65,
    insertionMarkerColour: '#c2f18a',
    insertionMarkerOpacity: 0.6,
    cursorColour: '#c2f18a',
  },
  fontStyle: { family: 'Manrope, Segoe UI, sans-serif', weight: '500', size: 14 },
  startHats: true,
});
// One spacing scale for the workspace, palette, and reference view.
const rendererOverrides = {
  NOTCH_WIDTH: 24,
  FIELD_BORDER_RECT_X_PADDING: 6,
  FIELD_BORDER_RECT_Y_PADDING: 4,
  FIELD_DROPDOWN_SVG_ARROW_PADDING: 6,
  SHAPE_IN_SHAPE_PADDING: {
    1: { 0: 12, 1: 8, 2: 12, 3: 12 },
    2: { 0: 8, 1: 8, 2: 4, 3: 8 },
    3: { 0: 8, 1: 8, 2: 8, 3: 8 },
  },
};
export const workspaceAppearance = {
  renderer: 'zelos',
  rendererOverrides,
  theme,
  media: '/vendor/blockly/media/',
  sounds: false,
  grid: { spacing: 22, length: 1, colour: '#3f5546', snap: false },
  zoom: { controls: false, wheel: true, startScale: 0.8, minScale: 0.35, maxScale: 1.6, scaleSpeed: 1.15 },
  move: { scrollbars: true, drag: true, wheel: true },
};
