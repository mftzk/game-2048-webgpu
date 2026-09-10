export const SIZE = 4;

let nextTileId = 1;

function freshTileId() {
  const id = nextTileId;
  nextTileId += 1;
  return id;
}

function emptyCells(tiles) {
  const occupied = new Set();
  for (const t of tiles) occupied.add(t.row * SIZE + t.col);
  const cells = [];
  for (let r = 0; r < SIZE; r += 1) {
    for (let c = 0; c < SIZE; c += 1) {
      const key = r * SIZE + c;
      if (!occupied.has(key)) cells.push({ row: r, col: c });
    }
  }
  return cells;
}

export function createBoard(rng = Math.random) {
  let tiles = [];
  tiles = spawnTile(tiles, rng);
  tiles = spawnTile(tiles, rng);
  return { tiles, score: 0, moves: 0 };
}

export function spawnTile(tiles, rng = Math.random) {
  const cells = emptyCells(tiles);
  if (cells.length === 0) return tiles.map((t) => ({ ...t }));
  const pick = cells[Math.floor(rng() * cells.length) % cells.length];
  const value = rng() < 0.9 ? 2 : 4;
  const tile = {
    id: freshTileId(),
    value,
    row: pick.row,
    col: pick.col,
    isNew: true,
    merged: false,
  };
  return [...tiles.map((t) => ({ ...t })), tile];
}

const DIRECTIONS = ["left", "right", "up", "down"];

function walkLine(dir, line, index) {
  const cells = [];
  for (let k = 0; k < SIZE; k += 1) {
    let row;
    let col;
    if (dir === "left") {
      row = line;
      col = k;
    } else if (dir === "right") {
      row = line;
      col = SIZE - 1 - k;
    } else if (dir === "up") {
      row = k;
      col = line;
    } else {
      row = SIZE - 1 - k;
      col = line;
    }
    cells.push({ row, col });
  }
  return cells;
}

function placeLine(dir, line, position) {
  if (dir === "left") return { row: line, col: position };
  if (dir === "right") return { row: line, col: SIZE - 1 - position };
  if (dir === "up") return { row: position, col: line };
  return { row: SIZE - 1 - position, col: line };
}

export function applyMove(tiles, dir) {
  if (!DIRECTIONS.includes(dir)) {
    return { tiles: tiles.map((t) => ({ ...t })), ghosts: [], gained: 0, moved: false };
  }

  const grid = new Map();
  for (const t of tiles) grid.set(`${t.row},${t.col}`, t);

  const nextTiles = [];
  const ghosts = [];
  let gained = 0;
  let moved = false;

  for (let line = 0; line < SIZE; line += 1) {
    const cells = walkLine(dir, line);
    const packed = [];
    for (const cell of cells) {
      const tile = grid.get(`${cell.row},${cell.col}`);
      if (tile) packed.push({ tile, from: cell });
    }

    const mergedLine = [];
    for (const entry of packed) {
      const last = mergedLine[mergedLine.length - 1];
      if (last && last.value === entry.tile.value && !last.merged) {
        last.value *= 2;
        last.merged = true;
        last.isNew = false;
        gained += last.value;
        ghosts.push({
          id: entry.tile.id,
          value: entry.tile.value,
          row: entry.from.row,
          col: entry.from.col,
        });
        moved = true;
      } else {
        mergedLine.push({
          id: entry.tile.id,
          value: entry.tile.value,
          isNew: false,
          merged: false,
          fromRow: entry.from.row,
          fromCol: entry.from.col,
        });
      }
    }

    mergedLine.forEach((tile, position) => {
      const dest = placeLine(dir, line, position);
      if (dest.row !== tile.fromRow || dest.col !== tile.fromCol) moved = true;
      nextTiles.push({
        id: tile.id,
        value: tile.value,
        row: dest.row,
        col: dest.col,
        isNew: false,
        merged: tile.merged,
      });
    });
  }

  return { tiles: nextTiles, ghosts, gained, moved };
}

export function movesAvailable(tiles) {
  const grid = new Map();
  for (const t of tiles) grid.set(`${t.row},${t.col}`, t.value);
  if (grid.size < SIZE * SIZE) return true;
  for (let r = 0; r < SIZE; r += 1) {
    for (let c = 0; c < SIZE; c += 1) {
      const v = grid.get(`${r},${c}`);
      if (c + 1 < SIZE && grid.get(`${r},${c + 1}`) === v) return true;
      if (r + 1 < SIZE && grid.get(`${r + 1},${c}`) === v) return true;
    }
  }
  return false;
}

export function tileValueAt(tiles, row, col) {
  for (const t of tiles) {
    if (t.row === row && t.col === col) return t.value;
  }
  return 0;
}
