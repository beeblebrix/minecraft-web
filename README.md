# Minecraft Web Prototype

Browser-based Minecraft-style game built in milestones so each step can be validated before the next one.

## Current status

- Milestone 1 complete: static voxel terrain + first-person movement.
- Milestone 2 complete: chunk data model, manager, and worker generation are live.
- Milestone 3 complete: targeting + break/place + selective chunk rebuilds.
- Milestone 4 complete: edited chunks persist in IndexedDB and reload correctly.
- Milestone 5 complete: hotbar + selected block UI + pause overlay.
- Milestone 6 in progress: day/night lighting, fog, and simple mob prototype.

## Run

```bash
npm install
npm run dev
```

Open the local Vite URL and click the canvas to capture the mouse.

## Milestone validation checklist

### Milestone 1

- [x] Terrain renders as a voxel chunk.
- [x] Mouse look with pointer lock works.
- [x] WASD movement, jump, gravity, sprint work.
- [x] HUD displays controls and position.

### Milestone 2

- [x] Replace static world with chunked world data.
- [x] Generate chunks in a worker.
- [x] Load and unload chunks by view distance.

### Milestone 3

- [x] Add block targeting raycast.
- [x] Break and place blocks.
- [x] Rebuild only affected chunk meshes.

### Milestone 4

- [x] Save modified chunks to IndexedDB.
- [x] Restore world state on reload.

### Milestone 5

- [x] Add hotbar UI.
- [x] Add selected block indicator and controls.
- [x] Add pause/help overlay when pointer is released.

### Milestone 6

- [x] Add dynamic time-of-day lighting tint.
- [x] Add atmospheric distance fog.
- [x] Add simple mob prototype (wander/chase).
- [x] Add basic player mob attack interaction.
- [x] Add core gameplay sound effects.
- [ ] Add optional crafting or deeper mob combat in later milestone.
