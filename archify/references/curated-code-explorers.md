# Multi-scale code explorers

For a repository explanation, give the reader three connected scales in one standalone HTML: **Project → Files → Methods**. Scrolling up over a diagram reveals detail; scrolling down restores context. The level buttons and Alt+Up/Down provide explicit and keyboard navigation. At the deepest level, native geometric zoom-in remains available. This is a local extension to Archify 3.2, assembled from separately verified native diagrams.

## Author connected levels

1. Pin one repository revision using Repository authoring. Identify the requested scope from its entry points, manifests and folder structure. Map every requested responsibility to an overview area and track which files and methods explain it. For a whole-project request, cover all first-party areas; separate vendored/generated code, tests, build tooling and optional paths explicitly. A few selected paths are a partial explorer, not a complete project map.
2. **Project:** use the original subsystem-level architecture. Keep the main user journey and meaningful branches visible. This is the initial view, not a wall of method names.
3. **Files, per area:** each local node is an actual source file; folder outlines show ownership. Derive cross-file edges from inspected calls, data exchange or wiring, with labels that preserve their meaning. Combine several calls only when their actions and conditions remain clear. Imports alone do not prove runtime calls.
4. **Methods, per area:** use [Code ownership maps](code-ownership-maps.md). Keep referenced methods in their defining file outlines and files in folder outlines. Follow execution to effects; retain callback execution, guards and shutdown behavior. Split areas at meaningful behavior boundaries when needed for legibility.
5. Map each file/API node to its displayed method/API IDs. Map each area to its project node IDs. Every displayed fine-level node must have an unambiguous coarse-level owner. Keep exact symbols and source links, and use the same revision throughout. State omitted coverage in the explorer's always-visible coverage sentence.

Run the native repository-backed `finalize` workflow for every diagram. Keep its candidate unchanged afterward: assembly verifies each HTML and candidate against the passing finalize receipt. Use existing verified artifacts when they already express the requested level. File and method maps of an area must describe the same behavior slice.

## Assemble

Write an explorer manifest (paths resolve relative to it):

```json
{
  "title": "Project code explorer",
  "coverage": "Describe the covered areas and any remaining gaps plainly.",
  "project": {"html": "project.html", "receipt": "project.finalize-summary.json"},
  "areas": [{
    "id": "orders", "label": "Order processing", "overviewNodes": ["order-service"],
    "files": {"html": "order-files.html", "receipt": "order-files.finalize-summary.json"},
    "methods": {"html": "order-methods.html", "receipt": "order-methods.finalize-summary.json"},
    "filesToMethods": {"handler-file": ["handle", "respond"], "service-file": ["validate", "save"]}
  }]
}
```

Replace the illustrative IDs with verified diagram IDs. External API nodes also need mappings. The builder rejects missing/ambiguous mappings, mixed revisions, changed artifacts or candidates, and non-passing native receipts.

```bash
node <installed-path>/scripts/build-code-explorer.mjs <manifest.json> <explorer.html>
node <installed-path>/scripts/check-code-explorer.mjs <explorer.html> <evidence-directory>
```

The builder embeds the original diagrams, including their source cards and native export controls. It does not infer new relationships. Scrolling over a mapped project node chooses its area; a selected file stays the context when switching scales. Scrolling over an overview-only node discloses the coverage gap instead of opening an unrelated area. Native copied reading links restore the explorer's area/level and the embedded view's state.

## Verify and deliver

The interaction check must pass for embedded-preview rendering at all three levels, buttons, wheel transitions, both scale directions, area selection, file/method context, keyboard navigation, copied-address restoration and narrow viewport containment with horizontal panning. A direct-file browser test alone does not verify an app's embedded preview: history updates may be forbidden there and must never stop drawing. Vertical wheel navigation must preserve sideways scrolling of wide diagrams. Inspect its captures and the method-level nested outlines in both themes. Native receipts validate constituent diagrams; the explorer check validates the assembled navigation. Claim each only when run.

Deliver the explorer link first. Disclose partial coverage and the pinned revision when relevant. Preserve editable candidates, the manifest and the local customization patch when updates may replace this installed extension. A native diagram export contains the current diagram; the complete explorer is the standalone HTML file.
