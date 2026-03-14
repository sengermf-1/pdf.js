# Modifications

Date: 2026-03-14

This fork modifies Mozilla PDF.js to add sidebar features for layers and
annotations, refine the sidebar presentation, and package compliance notices
for commercial redistribution.

The following files differ from upstream in this fork as of 2026-03-14:

- `src/display/annotation_layer.js`: Added annotation lookup support so sidebar
  comment edits can update rendered page annotations.
- `web/app.js`: Integrated the custom annotations sidebar viewer and comment
  manager wiring.
- `web/pdf_layer_viewer.js`: Added semantic tree classes for the customized
  layers sidebar presentation.
- `web/pdf_viewer.css`: Adjusted annotation pointer styling for the custom
  annotations sidebar flow.
- `web/tree.css`: Refined the layers tree presentation and overflow handling.
- `web/ui_utils.js`: Extended sidebar view identifiers to include the custom
  annotations panel.
- `web/viewer.html`: Added sidebar entries and containers for custom layers and
  annotations panels.
- `web/viewer.js`: Registered the custom annotations panel and comment editing
  dialog in the viewer configuration.
- `web/views_manager.css`: Updated sidebar selector icons for custom layers and
  annotations states.
- `web/views_manager.js`: Extended sidebar view switching to handle custom
  layers and annotations states.
- `web/pdf_annotation_viewer.js`: Added a custom annotations sidebar viewer
  with navigation and comment editing integration.
- `web/images/annotation-phosphor-*.svg`: Added Phosphor-based icons for
  annotation-related sidebar states.
- `gulpfile.mjs`: Added compliance notice documents to the generic and dist
  build outputs.
- `MODIFICATIONS.md`: Records the modification set distributed with this fork.
- `THIRD_PARTY_NOTICES.md`: Records third-party attribution and license text
  for bundled icons.
