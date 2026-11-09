# Code ownership maps

Use this for Architecture diagrams of repository behavior. Show the methods a reader can open and follow, with larger outlines explaining where they live. Read [the illustrative example](../examples/code-ownership.architecture.json) alongside the Architecture and common schemas; its invented order-service names are not repository evidence.

## Methods, files, folders

- A small component represents one referenced method or function. Label it with the actual symbol, such as `followPath()`; use its sublabel for the operation, receiver, overload, or consequential guard. Give it source ranges covering the declaration/body and the calls it owns. Constructors are useful when their wiring changes execution.
- A file outline contains the displayed methods defined in that file. Use the filename in its label and the relative path in each method's source. Put an inherited implementation in its defining file, while labelling the concrete receiver or dispatch edge. Split receiver-specific nodes only when their different dispatch behavior matters.
- A folder outline encloses the file outlines that actually belong to that path. Label it with the repository-relative folder or an unambiguous path suffix; state a shared omitted prefix once. Show useful ownership levels, not every ancestor directory.
- An external dependency can be a distinct `external` component with a library-qualified method label. Cite its local call site and disclose that the dependency body was not inspected; keep it outside repository file/folder outlines.

Trace from the requested entry point through the relevant internal methods to the actual output, state write, or external API. Include the gates, callbacks, and cleanup that change that path. Omit unrelated helpers and inventories. If a large repository needs several maps, split at behavior boundaries and carry the interface methods across maps; title each slice and state what is outside it. Keep method detail legible instead of collapsing it back into generic subsystem nodes.

## Calls and evidence

Arrows connect method nodes, never ownership frames. An import, shared folder, or execution order alone is not a call. Distinguish direct calls, queued callbacks, dynamic dispatch and returned data in labels when that distinction matters. Read both caller and target; for scheduling, include the method that actually executes the callback. Put critical guards in visible sublabels or edge labels: default READ view can hide tags and cards.

Every local method has a source in its owning file. A file's `wraps` is exactly its displayed method IDs; a folder's `wraps` is the union of its descendant method IDs. Verify membership against the cited paths, not visual proximity. Keep inspection and source pinning from [Repository authoring](repository-authoring.md).

## Encoding and placement

Use existing Architecture `boundaries` with `kind: "region"` and explicit labels `File: Example.java` / `Folder: src/example/`. Both express code ownership; `security-group` remains a real security boundary. The schema has no `parent` field: nested outlines are expressed by subset membership, and `wraps` contains component IDs, not boundary labels.

Use explicit padding at each level, for example `pad: 20` on a file and `pad: 48` on its folder. Explicit padding applies on all four sides. A parent's padding must leave a visible gap outside the child frames; allow additional room for stacked title rails. Draw outer folders before inner files. Position the first methods far enough from the canvas origin to accommodate the outer padding.

Keep each file and folder a compact rectangular cluster. Sibling ownership frames are disjoint; a parent contains its entire child frame. Give method-to-method routes clear corridors between clusters and cross outline borders rather than running along them. Use concise symbols, sufficient node width and normal readable text. Use separate behavior maps if truthful containment and readable calls cannot coexist on one canvas.

## Delivery check

Run the normal repository-backed `finalize` command. Check the authored membership sets against source paths, then inspect light/dark captures for the nested view: file/folder title rails, all four edges of containment, sibling separation, and arrow endpoint/label clarity. Ordinary Architecture validation does not prove filesystem ownership. Keep the source-backed hierarchy intact during repairs. Completion means a reader can identify a method, its file, its folder, its real caller/callee and supporting source without guessing.
