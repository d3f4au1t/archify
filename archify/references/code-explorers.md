# Continuous repository explorers

Use one spatial map to explain a directory or repository. Large outlines contain folders, smaller outlines contain actual files, and the smallest boxes are declared methods, constructors or functions. Zoom changes the amount of detail while the ownership geometry stays fixed. This local extension has its own source-index and browser checks; it is not a native Architecture `finalize` artifact.

## Establish complete coverage

1. Freeze repository identity and revision using [Repository authoring](repository-authoring.md). Preserve dirty files and state whether the graph describes committed or working-tree bytes. Source links must match the indexed snapshot.
2. Inventory every tracked path in the requested scope. Classify production code, local library patches, SDK samples, tests/stubs, tools, configuration, documentation and resources. Keep each file reachable in search and the ownership tree. Report excluded untracked/generated paths explicitly.
3. Parse declarations with the language's syntax tree. Index all declared methods, constructors, nested functions and classes; retain defining file, owner, signature, source range and documentation. File details should also expose declared fields and inheritance. Record unsupported languages as file-only coverage; never describe them as method-complete.
4. Extract call sites separately from declarations. Resolve a link only to a defensible local declaration. Preserve unresolved/external calls in the inspector rather than removing them. Distinguish static call candidates, method references, imports, callbacks and narrated runtime sequences. Runtime code must never resolve to same-named test stubs. Ambiguous overloads and dynamic dispatch remain qualified.
5. Preserve exact folder and file names, including case and extensions, as titles everywhere: canvas, breadcrumbs, search, lists and source details. Descriptive area labels such as "Intake and feed" are subtitles, never replacement names. Add source-backed summaries for the major areas and guided flows for entry, normal operation, important branches, asynchronous work and shutdown. A parser supplies structure; inspected control flow explains behavior. Record the source file, symbol and evidence line for each narrated step. Mark offline handoffs and callbacks explicitly.

Coverage is measured against the inventory, not a target node count. A few representative methods are a scoped example; a comprehensive project map includes every supported declaration and makes its remaining gaps visible.

## Build the Java/Python explorer

The included builder uses the installed JDK compiler parser for Java and Python's standard AST. It reads a pinned Git snapshot, does not execute project code, and writes a standalone HTML, editable `.index.json`, and `.index-check.json`. Requires Python 3.12+ and JDK 17+. Other languages remain file-only until an appropriate parser is added; do not infer their call graphs with name matching alone.

Author optional notes in this shape, using the actual revision and source evidence:

```json
{
  "revision": "<40-character revision>",
  "areas": [{"path": "src/orders", "label": "Order handling", "summary": "Source-backed responsibility."}],
  "flows": [{"name": "Submit an order", "steps": [{"path": "src/orders/Handler.java", "symbol": "submit", "line": 24, "note": "Observed operation and its condition."}]}],
  "limitations": ["Any source-specific limitations."]
}
```

```bash
python3 <installed-path>/scripts/build-repository-explorer.py <repo> <explorer.html> --revision <revision> --notes <notes.json>
python3 <installed-path>/scripts/test-repository-index.py
node <installed-path>/scripts/test-method-layout.mjs <explorer.index.json>
node <installed-path>/scripts/test-edge-direction.mjs
node <installed-path>/scripts/check-repository-explorer.mjs <explorer.html> <evidence-directory>
```

Each area's `path` identifies the real folder or file; its `label` supplies a descriptive subtitle. The builder keeps the original basename as the title.

The source index is conservative static analysis. A resolved receiver/name/arity does not prove which override ran, and imports do not prove calls. Source evidence for a relationship belongs to its caller or importing file, not its destination. Present known extraction gaps in Coverage, accessible at every viewport size.

For a deliberately small set of curated native diagrams, the older [curated explorer](curated-code-explorers.md) remains available. Use it only when discrete diagram switching is appropriate. A request for natural scrolling or continuous scale transitions uses the single canvas above.

## Interaction contract

- The canvas occupies the available viewport and owns wheel/pinch input. Its page stays stationary. Inspector text may scroll independently.
- Wheel deltas change scale continuously around the pointer; pinch also preserves its center. Dragging pans. A gesture's speed must not accidentally jump entire abstraction levels.
- Folder, file and method boxes retain their positions. Detail fades in when its projected size is readable; coarse labels fade out as their children become legible. Avoid a minimum text size that overlaps descendants in tiny header bands.
- Leave deliberate empty space between neighboring folders/files and between unrelated call groups. Keep related methods closer together, increase ownership-region gaps with their size, and preserve generous inner padding. Do not compress everything to fill the canvas; users can zoom and pan. Change the saved-layout version when geometry changes so older links refit their selected source node.
- Paint box fills and borders first, connections second, and all folder/file/method labels and group headings last. Lines may cross colored cells and outlines, but must never paint over their text. Use a thin glyph outline matching the cell background to protect letters from bright highlighted lines; preserve the same fade and selection opacity in the label pass.
- Draw exactly one arrowhead at each directed connection's destination. Separate incoming and outgoing attachment points so overlapping links do not appear double-headed; keep genuine reverse relationships as distinct directed lines.
- Within each file, group methods by their declared class or lexical owner. Arrange connected methods in directed call chains, callers to the left of callees; shared callees appear once and recursive cycles stay together. Separate disconnected chains with space and headings. Put unlinked constructors and other methods in labeled source-order groups. Never impose an alphabetical tile grid or invent calls to obtain a tidy hierarchy. Class/group headings explain layout, not new source folders. Keep inspector reading order aligned with these groups, and preserve all declarations and click highlighting.
- Double-click enters a box; Overview restores the whole map; Up shows its parent. Search reaches every file/method, and source details expose incoming/outgoing links, unresolved sites and source text. Keyboard navigation and reduced-motion settings remain usable.
- Clicking a method highlights that method, its direct callers, its callees and the exact connecting edges; unrelated content dims. Keep owning containers visible when a neighbor is collapsed or offscreen. Preserve the camera on selection, offer Fit connections for the complete neighborhood, and clear focus with Escape or an empty-canvas click.
- Opening or closing the inspector changes the available canvas size before calculating a target fit. Folder connection filters include descendants; a method filter identifies that method alone.
- Embedded previews may reject browser history changes. Saving a reading address is optional and must never stop rendering. Preserve JavaScript-free recovery text and show errors instead of silently claiming a blank view is ready.

## Verify and deliver

Check inventory counts, unique symbol IDs, source ranges, owner containment, edge endpoints, overloaded/duplicate names and test-stub isolation. Browser checks must exercise small wheel increments, pointer anchoring, zoom reversal, drag cancellation, pinch input, keyboard controls, search, source evidence, narrow layouts, independent inspector scrolling and embedded previews. Assert the document stays at scroll position zero throughout canvas gestures. Inspect overview, file and method views in both themes; a passing outer-page overflow check alone is insufficient.

Open the finished explorer in the user's available browser surface and verify a real file-to-method journey there. Keep the source index, notes and verification receipt with the deliverable. Preserve the installed customization patch. Report inventory coverage separately from call-resolution coverage, and retain important limitations in the interface and final reply.
