function layoutMethods(file, outgoing) {
  const rowGap = 32, componentGap = 24, blockGap = 88;
  const rowStride = 80 + rowGap, columnStride = 304 + 128;
  const order = (a, b) => a.line - b.line || a.id.localeCompare(b.id);
  const owners = new Map();
  for (const method of [...file.children].sort(order)) {
    method.w = 304; method.h = 80; method.header = 0;
    if (!owners.has(method.ownerName)) owners.set(method.ownerName, []);
    owners.get(method.ownerName).push(method);
  }
  file.header = 128; file.sections = []; file.w = 432;
  let y = 152;
  for (const [owner, methods] of owners) {
    const byId = new Map(methods.map(m => [m.id, m]));
    const next = new Map(methods.map(m => [m.id, new Set()]));
    const adjacent = new Map(methods.map(m => [m.id, new Set()]));
    for (const method of methods) for (const edge of outgoing.get(method.id) || []) {
      if (!byId.has(edge.to)) continue;
      next.get(method.id).add(edge.to);
      adjacent.get(method.id).add(edge.to); adjacent.get(edge.to).add(method.id);
    }
    const section = {owner: owner || 'Module functions', x: 40, y, w: 352, h: 0, blocks: []};
    let blockY = y + 48;
    const visited = new Set();
    for (const method of methods) {
      if (visited.has(method.id) || !adjacent.get(method.id).size) continue;
      const connected = [], pending = [method.id];
      while (pending.length) {
        const id = pending.pop(); if (visited.has(id)) continue;
        visited.add(id); connected.push(byId.get(id)); pending.push(...adjacent.get(id));
      }
      connected.sort(order);
      // Collapse recursive cycles before ranking; every other local call advances right.
      const index = new Map(), low = new Map(), stack = [], onStack = new Set(), components = [];
      function visit(id) {
        index.set(id, index.size); low.set(id, index.get(id)); stack.push(id); onStack.add(id);
        for (const target of next.get(id)) {
          if (!index.has(target)) { visit(target); low.set(id, Math.min(low.get(id), low.get(target))); }
          else if (onStack.has(target)) low.set(id, Math.min(low.get(id), index.get(target)));
        }
        if (low.get(id) === index.get(id)) {
          const members = []; let target;
          do { target = stack.pop(); onStack.delete(target); members.push(byId.get(target)); } while (target !== id);
          components.push({members: members.sort(order), next: new Set(), parents: new Set(), rank: 0});
        }
      }
      for (const m of connected) if (!index.has(m.id)) visit(m.id);
      const componentOf = new Map();
      for (const component of components) for (const m of component.members) componentOf.set(m.id, component);
      for (const m of connected) for (const id of next.get(m.id)) {
        const a = componentOf.get(m.id), b = componentOf.get(id);
        if (a !== b) { a.next.add(b); b.parents.add(a); }
      }
      const roots = components.filter(c => !c.parents.size).sort((a, b) => order(a.members[0], b.members[0]));
      const degree = new Map(components.map(c => [c, c.parents.size])), queue = [...roots];
      for (let i = 0; i < queue.length; i++) for (const target of queue[i].next) {
        target.rank = Math.max(target.rank, queue[i].rank + 1);
        degree.set(target, degree.get(target) - 1); if (!degree.get(target)) queue.push(target);
      }
      const columns = new Map();
      for (const component of components) {
        if (!columns.has(component.rank)) columns.set(component.rank, []);
        columns.get(component.rank).push(component);
      }
      let blockHeight = 0;
      for (const [rank, column] of [...columns].sort((a, b) => a[0] - b[0])) {
        const center = c => c.parents.size ? [...c.parents].reduce((sum, p) => sum + p.center, 0) / c.parents.size : c.members[0].line;
        column.sort((a, b) => center(a) - center(b) || order(a.members[0], b.members[0]));
        let offset = 0;
        for (const component of column) {
          const start = offset;
          for (const m of component.members) { m.x = 64 + rank * columnStride; m.y = blockY + 56 + offset; offset += rowStride; }
          component.center = (start + offset - rowGap) / 2;
          offset += componentGap;
        }
        blockHeight = Math.max(blockHeight, offset - rowGap - componentGap);
      }
      const width = (columns.size - 1) * columnStride + 352;
      const names = roots.flatMap(c => c.members.map(m => m.label)).join(', ');
      section.blocks.push({label: 'Calls from ' + names, x: 64, y: blockY, w: width - 48, h: blockHeight + 56, ids: connected.sort((a,b) => a.x-b.x || a.y-b.y).map(m => m.id)});
      section.w = Math.max(section.w, width); blockY += blockHeight + 56 + blockGap;
    }
    const unlinked = methods.filter(m => !adjacent.get(m.id).size);
    const groups = [
      ['Constructors', unlinked.filter(m => m.constructor === true)],
      ['Other methods', unlinked.filter(m => m.constructor !== true)]
    ];
    for (const [label, members] of groups) {
      if (!members.length) continue;
      const rows = Math.min(6, members.length), cols = Math.ceil(members.length / rows);
      members.forEach((m, i) => { m.x = 64 + Math.floor(i / rows) * 368; m.y = blockY + 56 + (i % rows) * rowStride; });
      const width = (cols - 1) * 368 + 352, height = (rows - 1) * rowStride + 80 + 56;
      section.blocks.push({label: owner ? label : 'Module functions · source order', x: 64, y: blockY, w: width - 48, h: height, ids: members.map(m => m.id)});
      section.w = Math.max(section.w, width); blockY += height + blockGap;
    }
    section.h = blockY - y - 36; file.sections.push(section);
    file.w = Math.max(file.w, section.w + 64); y = blockY + 28;
  }
  file.h = Math.max(192, y);
}
