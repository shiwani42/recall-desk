// AG Studio theme for Recall Desk. Every value points at a token in app/globals.css, so Studio,
// its grids and its charts follow the rest of the app, including dark mode (the tokens switch
// under prefers-color-scheme, and Studio reads them live).

import { studioTheme } from "ag-studio";

const token = (name: string) => `var(--${name})`;
const line = (color: string) => ({ width: 1, color: token(color) });
const FONT = "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif";

export const recallStudioTheme = studioTheme.withParams({
  fontFamily: FONT,
  fontSize: 14,
  textColor: token("foreground"),
  foregroundColor: token("foreground"),
  subtleTextColor: token("muted"),
  backgroundColor: token("surface"),
  borderColor: token("line"),
  accentColor: token("accent"),
  iconColor: token("muted"),
  rowHoverColor: token("surface-2"),

  // The canvas is the page background; widgets are the app's cards.
  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: token("background"),
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: token("background"),
  studioCanvasPadding: 16,
  studioCanvasRowHeight: 18,
  studioCanvasFontFamily: FONT,

  studioWidgetBackgroundColor: token("surface"),
  studioWidgetBorder: false,
  studioWidgetBorderRadius: 20,
  studioWidgetPadding: 16,
  studioWidgetTitleFontFamily: FONT,
  studioWidgetTitleFontSize: 14,
  studioWidgetTitleFontWeight: 500,
  studioWidgetTitleTextColor: token("foreground"),
  studioWidgetSubtitleFontFamily: FONT,
  studioWidgetSubtitleFontSize: 12,
  studioWidgetSubtitleTextColor: token("muted"),
  studioWidgetCaptionFontFamily: FONT,
  studioWidgetCaptionFontSize: 12,
  studioWidgetCaptionTextColor: token("muted"),
  studioWidgetResizeBorderColor: token("accent"),

  studioPanelContainerBackgroundColor: token("surface"),
  studioPanelContainerBorder: line("line"),
  studioPanelContainerBorderRadius: 0,
  studioPanelDividerColor: token("line"),
  studioPanelDividerActiveColor: token("accent"),
  studioPanelSectionBorderColor: token("line"),
  studioPanelHeaderFontFamily: FONT,
  studioPanelHeaderFontWeight: 600,
  studioPanelChevronButtonHoverBackgroundColor: token("accent-soft"),
  studioPanelChevronButtonHoverColor: token("accent"),
  studioToggleButtonActiveBackgroundColor: token("accent-soft"),
  studioToggleButtonActiveBorderColor: token("accent"),
  studioToggleButtonActiveColor: token("accent"),

  // Grids: numbers right-aligned by Studio; quiet headers and dividers.
  gridFontFamily: FONT,
  gridFontSize: 13,
  gridCellTextColor: token("foreground"),
  gridHeaderBackgroundColor: token("surface"),
  gridHeaderTextColor: token("muted"),
  gridHeaderFontWeight: 600,
  gridHeaderFontSize: 12,
  gridRowHeight: 36,
  gridRowBorder: line("line"),
  gridHeaderRowBorder: line("line"),
  gridPinnedRowBorder: line("line"),
  gridRowHoverColor: token("surface-2"),
  gridWrapperBorder: false,

  chartFontFamily: FONT,
  chartTextColor: token("foreground"),
  chartSubtleTextColor: token("muted"),
  chartAxisLineColor: token("line"),
  chartGridLineColor: token("line"),
});
