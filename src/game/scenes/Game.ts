import { EventBus } from "../EventBus";
import { Scene } from "phaser";

interface NpcData {
  sprite: Phaser.GameObjects.Sprite;
  tileX: number;
  tileY: number;
  tiles: { x: number; y: number }[];
  messages: string[];
}

export class Game extends Scene {
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private player!: Phaser.GameObjects.Sprite;
  private walls!: Phaser.Tilemaps.TilemapLayer;
  private map!: Phaser.Tilemaps.Tilemap;

  // Movimiento grid
  private isMoving = false;
  private movePath: { x: number; y: number }[] = [];
  private cursor!: Phaser.GameObjects.Rectangle;
  private blocked = new Set<number>();

  // NPCs
  private npcs = new Map<string, NpcData>();
  private pendingNpc: NpcData | null = null;

  // Diálogo
  private isTalking = false;
  private talkQueue: string[] = [];
  private talkIndex = 0;
  private dialogBg?: Phaser.GameObjects.Rectangle;
  private dialogText?: Phaser.GameObjects.Text;
  private dialogHint?: Phaser.GameObjects.Text;
  private keyEnter!: Phaser.Input.Keyboard.Key;
  private keySpace!: Phaser.Input.Keyboard.Key;

  private readonly TILE = 16;
  private readonly MOVE_MS = 150;

  private tileKey(x: number, y: number) {
    return (y << 16) | x;
  }

  private isTileBlocked(x: number, y: number) {
    return (
      !!this.walls.getTileAt(x, y) || this.blocked.has(this.tileKey(x, y))
    );
  }

  constructor() {
    super("Game");
  }

  preload() {
    this.load.on("loaderror", (file: any) => {
      console.error("Error cargando:", file.key, file.src);
    });

    this.load.tilemapTiledJSON("map", "/assets/maps/map.json");
    this.load.image("dungeon", "/assets/tilesets/tiles.png");

    this.load.spritesheet("player-up", "/assets/characters/hero/hero_up.png", {
      frameWidth: 64,
      frameHeight: 64,
    });
    this.load.spritesheet(
      "player-down",
      "/assets/characters/hero/hero_down.png",
      { frameWidth: 64, frameHeight: 64 }
    );
    this.load.spritesheet(
      "player-left",
      "/assets/characters/hero/hero_side.png",
      { frameWidth: 64, frameHeight: 64 }
    );

    this.load.spritesheet(
      "npc1-down",
      "/assets/characters/npc1/ncp1_down.png",
      { frameWidth: 64, frameHeight: 64 }
    );
  }

  create() {
    this.map = this.make.tilemap({ key: "map" });

    const tileset = this.map.addTilesetImage("tileset", "dungeon");
    if (!tileset) throw new Error("No se pudo añadir el tileset.");

    const ground = this.map.createLayer("Ground", tileset, 0, 0);
    this.walls = this.map.createLayer("Walls", tileset, 0, 0)!;
    if (!ground || !this.walls)
      throw new Error("No se encontraron las capas Ground/Walls.");

    this.walls.setCollisionByExclusion([-1]);

    // Spawn alineado a grid
    const objLayer = this.map.getObjectLayer("Objects");
    const spawn = objLayer?.objects.find((o) => o.name === "playerSpawn");
    if (!spawn) throw new Error("No se encontró playerSpawn en la capa Objects.");

    const spawnTileX = Math.floor((spawn.x ?? 0) / this.TILE);
    const spawnTileY = Math.floor((spawn.y ?? 0) / this.TILE);
    const spawnX = spawnTileX * this.TILE + this.TILE / 2;
    const spawnY = spawnTileY * this.TILE + this.TILE / 2;

    this.player = this.add.sprite(spawnX, spawnY, "player-down", 0);
    this.player.setScale(0.5);
    this.player.setDepth(10);

    // --- NPCs ---
    this.spawnNpc(objLayer, "ncp1", "npc1-down", [
      "Hola, aventurero.",
      "Bienvenido al mundo de Studio LXD.",
      "Explora el mapa y habla con todos.",
    ]);

    // Cámara
    this.updateCamera(this.scale.width, this.scale.height);
    this.scale.on("resize", (gameSize: Phaser.Structs.Size) => {
      this.cameras.main.setViewport(0, 0, gameSize.width, gameSize.height);
      this.updateCamera(gameSize.width, gameSize.height);
      this.repositionDialog(gameSize.width, gameSize.height);
    });

    // Input teclado
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keyEnter = this.input.keyboard!.addKey(
      Phaser.Input.Keyboard.KeyCodes.ENTER
    );
    this.keySpace = this.input.keyboard!.addKey(
      Phaser.Input.Keyboard.KeyCodes.SPACE
    );

    // Cursor visual
    this.cursor = this.add
      .rectangle(0, 0, this.TILE, this.TILE)
      .setStrokeStyle(1, 0xffffff, 0.6)
      .setFillStyle(0xffffff, 0.15)
      .setDepth(5)
      .setVisible(false);

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const tileX = Math.floor(world.x / this.TILE);
      const tileY = Math.floor(world.y / this.TILE);

      if (
        tileX < 0 ||
        tileX >= this.map.width ||
        tileY < 0 ||
        tileY >= this.map.height
      ) {
        this.cursor.setVisible(false);
        return;
      }

      this.cursor.setPosition(
        tileX * this.TILE + this.TILE / 2,
        tileY * this.TILE + this.TILE / 2
      );
      this.cursor.setVisible(true);

      if (this.getNpcAt(tileX, tileY)) {
        this.cursor.setStrokeStyle(1, 0x44ff44, 0.6);
        this.cursor.setFillStyle(0x44ff44, 0.15);
      } else if (this.isTileBlocked(tileX, tileY)) {
        this.cursor.setStrokeStyle(1, 0xff4444, 0.6);
        this.cursor.setFillStyle(0xff4444, 0.15);
      } else {
        this.cursor.setStrokeStyle(1, 0xffffff, 0.6);
        this.cursor.setFillStyle(0xffffff, 0.15);
      }
    });

    // Click: diálogo o mover
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      // Avanzar diálogo
      if (this.isTalking) {
        this.advanceDialog();
        return;
      }

      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const targetX = Math.floor(world.x / this.TILE);
      const targetY = Math.floor(world.y / this.TILE);

      const currentX = Math.floor(this.player.x / this.TILE);
      const currentY = Math.floor(this.player.y / this.TILE);

      // Click sobre NPC → interactuar o caminar hacia él
      const npc = this.getNpcAt(targetX, targetY);
      if (npc) {
        if (this.isAdjacentToNpc(npc)) {
          this.openDialog(npc.messages);
        } else {
          const adj = this.findAdjacentFree(npc);
          if (adj) {
            const path = this.findPath(currentX, currentY, adj.x, adj.y);
            if (path.length > 0) {
              this.pendingNpc = npc;
              this.movePath = path;
            }
          }
        }
        return;
      }

      // Pathfinding normal
      this.pendingNpc = null;
      const path = this.findPath(currentX, currentY, targetX, targetY);
      if (path.length > 0) {
        this.movePath = path;
      }
    });

    this.createPlayerAnims();
    EventBus.emit("current-scene-ready", this);
  }

  update() {
    if (!this.player || !this.cursors) return;

    // --- Diálogo activo: bloquear movimiento ---
    if (this.isTalking) {
      if (
        Phaser.Input.Keyboard.JustDown(this.keyEnter) ||
        Phaser.Input.Keyboard.JustDown(this.keySpace)
      ) {
        this.advanceDialog();
      }
      return;
    }

    if (this.isMoving) return;

    // Interactuar con NPC (Enter o Space)
    if (Phaser.Input.Keyboard.JustDown(this.keyEnter) || Phaser.Input.Keyboard.JustDown(this.keySpace)) {
      const adj = this.getAdjacentNpc();
      if (adj) {
        this.openDialog(adj.messages);
        return;
      }
    }

    let dx = 0;
    let dy = 0;

    if (this.cursors.left?.isDown) {
      dx = -1;
      this.movePath = [];
    } else if (this.cursors.right?.isDown) {
      dx = 1;
      this.movePath = [];
    } else if (this.cursors.up?.isDown) {
      dy = -1;
      this.movePath = [];
    } else if (this.cursors.down?.isDown) {
      dy = 1;
      this.movePath = [];
    } else if (this.movePath.length > 0) {
      const next = this.movePath.shift()!;
      const cx = Math.floor(this.player.x / this.TILE);
      const cy = Math.floor(this.player.y / this.TILE);
      dx = next.x - cx;
      dy = next.y - cy;
    } else {
      this.player.anims.stop();
      return;
    }

    const cx = Math.floor(this.player.x / this.TILE);
    const cy = Math.floor(this.player.y / this.TILE);
    const tx = cx + dx;
    const ty = cy + dy;

    if (tx < 0 || tx >= this.map.width || ty < 0 || ty >= this.map.height)
      return;

    if (this.isTileBlocked(tx, ty)) {
      this.movePath = [];
      this.player.anims.stop();
      // Si hay un NPC en ese tile, abrir diálogo
      const npc = this.getNpcAt(tx, ty);
      if (npc) {
        this.openDialog(npc.messages);
      }
      return;
    }

    // Animación y flip
    if (dx < 0) {
      this.player.setFlipX(true);
      this.player.anims.play("walk-left", true);
    } else if (dx > 0) {
      this.player.setFlipX(false);
      this.player.anims.play("walk-left", true);
    } else if (dy < 0) {
      this.player.setFlipX(false);
      this.player.anims.play("walk-up", true);
    } else if (dy > 0) {
      this.player.setFlipX(false);
      this.player.anims.play("walk-down", true);
    }

    const destX = tx * this.TILE + this.TILE / 2;
    const destY = ty * this.TILE + this.TILE / 2;

    this.isMoving = true;
    this.tweens.add({
      targets: this.player,
      x: destX,
      y: destY,
      duration: this.MOVE_MS,
      onComplete: () => {
        this.isMoving = false;
        this.player.x = destX;
        this.player.y = destY;

        if (
          this.movePath.length === 0 &&
          !this.cursors.left?.isDown &&
          !this.cursors.right?.isDown &&
          !this.cursors.up?.isDown &&
          !this.cursors.down?.isDown
        ) {
          this.player.anims.stop();

          if (this.pendingNpc) {
            const npc = this.pendingNpc;
            this.pendingNpc = null;
            if (this.isAdjacentToNpc(npc)) {
              this.openDialog(npc.messages);
            }
          }
        }
      },
    });
  }

  // ─── NPC helpers ───

  private spawnNpc(
    objLayer: Phaser.Tilemaps.ObjectLayer | null,
    objectName: string,
    spriteKey: string,
    fallbackMessages: string[]
  ) {
    const obj = objLayer?.objects.find((o) => o.name === objectName);
    if (!obj) return;

    const tileX = Math.floor((obj.x ?? 0) / this.TILE);
    const tileY = Math.floor((obj.y ?? 0) / this.TILE);

    const sprite = this.add.sprite(
      tileX * this.TILE + this.TILE / 2,
      tileY * this.TILE + this.TILE / 2,
      spriteKey,
      0
    );
    sprite.setScale(0.5);
    sprite.setDepth(10);

    // Leer mensajes desde Tiled (propiedad "messages" separada por |)
    const props = obj.properties as
      | { name: string; value: unknown }[]
      | undefined;
    const raw = props?.find((p) => p.name === "messages")?.value as
      | string
      | undefined;
    const messages = raw
      ? raw
          .split("|")
          .map((s) => s.trim())
          .filter(Boolean)
      : fallbackMessages;

    const tiles = [{ x: tileX, y: tileY }];
    this.blocked.add(this.tileKey(tileX, tileY));
    this.npcs.set(objectName, { sprite, tileX, tileY, tiles, messages });
  }

  private getNpcAt(tileX: number, tileY: number): NpcData | null {
    for (const npc of this.npcs.values()) {
      if (npc.tiles.some((t) => t.x === tileX && t.y === tileY)) return npc;
    }
    return null;
  }

  private isAdjacentToNpc(npc: NpcData): boolean {
    const px = Math.floor(this.player.x / this.TILE);
    const py = Math.floor(this.player.y / this.TILE);
    const npcTiles = new Set(npc.tiles.map((t) => this.tileKey(t.x, t.y)));
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      if (npcTiles.has(this.tileKey(px + dx, py + dy))) return true;
    }
    return false;
  }

  private findAdjacentFree(npc: NpcData): { x: number; y: number } | null {
    const px = Math.floor(this.player.x / this.TILE);
    const py = Math.floor(this.player.y / this.TILE);
    const npcTiles = new Set(npc.tiles.map((t) => this.tileKey(t.x, t.y)));
    let best: { x: number; y: number } | null = null;
    let bestDist = Infinity;

    for (const t of npc.tiles) {
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = t.x + dx;
        const ny = t.y + dy;
        if (npcTiles.has(this.tileKey(nx, ny))) continue;
        if (nx >= 0 && nx < this.map.width && ny >= 0 && ny < this.map.height && !this.isTileBlocked(nx, ny)) {
          const dist = Math.abs(px - nx) + Math.abs(py - ny);
          if (dist < bestDist) {
            bestDist = dist;
            best = { x: nx, y: ny };
          }
        }
      }
    }
    return best;
  }

  private getAdjacentNpc(): NpcData | null {
    for (const npc of this.npcs.values()) {
      if (this.isAdjacentToNpc(npc)) return npc;
    }
    return null;
  }

  // ─── Diálogo ───

  private openDialog(messages: string[]) {
    if (this.isTalking) return;

    this.isTalking = true;
    this.talkQueue = messages;
    this.talkIndex = 0;
    this.movePath = [];
    this.player.anims.stop();

    const z = this.ZOOM;
    const sw = this.scale.width;
    const sh = this.scale.height;
    const boxH = 40;  // world units (renders as boxH * z screen px)
    const pad = 4;    // world units

    const bgPos = this.screenToHUD(0, sh - boxH * z);
    const textPos = this.screenToHUD(pad * z, sh - boxH * z + pad * z);
    const hintPos = this.screenToHUD(sw - pad * z, sh - pad * z);

    this.dialogBg = this.add
      .rectangle(bgPos.x, bgPos.y, sw / z, boxH, 0x000000, 0.85)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(1000);

    this.dialogText = this.add
      .text(textPos.x, textPos.y, "", {
        fontFamily: "monospace",
        fontSize: "7px",
        color: "#ffffff",
        wordWrap: { width: sw / z - pad * 2 },
      })
      .setScrollFactor(0)
      .setDepth(1001);

    this.dialogHint = this.add
      .text(hintPos.x, hintPos.y, "[Enter / Click]", {
        fontFamily: "monospace",
        fontSize: "4px",
        color: "#aaaaaa",
      })
      .setOrigin(1, 1)
      .setScrollFactor(0)
      .setDepth(1001);

    this.showLine();
  }

  private repositionDialog(w: number, h: number) {
    if (!this.isTalking) return;
    const z = this.ZOOM;
    const boxH = 40;
    const pad = 4;

    const bgPos = this.screenToHUD(0, h - boxH * z);
    const textPos = this.screenToHUD(pad * z, h - boxH * z + pad * z);
    const hintPos = this.screenToHUD(w - pad * z, h - pad * z);

    this.dialogBg?.setPosition(bgPos.x, bgPos.y).setSize(w / z, boxH);
    this.dialogText?.setPosition(textPos.x, textPos.y);
    this.dialogText?.setWordWrapWidth(w / z - pad * 2);
    this.dialogHint?.setPosition(hintPos.x, hintPos.y);
  }

  private showLine() {
    this.dialogText?.setText(this.talkQueue[this.talkIndex] ?? "");
  }

  private advanceDialog() {
    this.talkIndex++;
    if (this.talkIndex >= this.talkQueue.length) {
      this.closeDialog();
    } else {
      this.showLine();
    }
  }

  private closeDialog() {
    this.isTalking = false;
    this.talkQueue = [];
    this.talkIndex = 0;

    this.dialogBg?.destroy();
    this.dialogText?.destroy();
    this.dialogHint?.destroy();
    this.dialogBg = undefined;
    this.dialogText = undefined;
    this.dialogHint = undefined;
  }

  // ─── Pathfinding A* ───

  private findPath(
    sx: number,
    sy: number,
    ex: number,
    ey: number
  ): { x: number; y: number }[] {
    if (ex < 0 || ex >= this.map.width || ey < 0 || ey >= this.map.height)
      return [];
    if (this.isTileBlocked(ex, ey)) return [];

    type Node = {
      x: number;
      y: number;
      g: number;
      f: number;
      parent: Node | null;
    };

    const key = (x: number, y: number) => (y << 16) | x;
    const h = (x: number, y: number) => Math.abs(x - ex) + Math.abs(y - ey);

    const open: Node[] = [
      { x: sx, y: sy, g: 0, f: h(sx, sy), parent: null },
    ];
    const closed = new Set<number>();

    while (open.length > 0) {
      let bestIdx = 0;
      for (let i = 1; i < open.length; i++) {
        if (open[i].f < open[bestIdx].f) bestIdx = i;
      }
      const cur = open.splice(bestIdx, 1)[0];

      if (cur.x === ex && cur.y === ey) {
        const path: { x: number; y: number }[] = [];
        let n: Node | null = cur;
        while (n?.parent) {
          path.unshift({ x: n.x, y: n.y });
          n = n.parent;
        }
        return path;
      }

      closed.add(key(cur.x, cur.y));

      for (const [nx, ny] of [
        [cur.x - 1, cur.y],
        [cur.x + 1, cur.y],
        [cur.x, cur.y - 1],
        [cur.x, cur.y + 1],
      ]) {
        if (nx < 0 || nx >= this.map.width || ny < 0 || ny >= this.map.height)
          continue;
        if (closed.has(key(nx, ny))) continue;
        if (this.isTileBlocked(nx, ny)) continue;

        const g = cur.g + 1;
        const existing = open.find((o) => o.x === nx && o.y === ny);
        if (!existing) {
          open.push({ x: nx, y: ny, g, f: g + h(nx, ny), parent: cur });
        } else if (g < existing.g) {
          existing.g = g;
          existing.f = g + h(nx, ny);
          existing.parent = cur;
        }
      }
    }

    return [];
  }

  // ─── HUD helpers ───

  /** Convierte coordenadas de pantalla a mundo para objetos scrollFactor(0) con zoom */
  private screenToHUD(sx: number, sy: number): { x: number; y: number } {
    const z = this.ZOOM;
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    return { x: (sx - cx) / z + cx, y: (sy - cy) / z + cy };
  }

  // ─── Cámara responsive ───

  private readonly ZOOM = 3;

  private updateCamera(w: number, h: number) {
    const cam = this.cameras.main;
    cam.setZoom(this.ZOOM);

    const mapW = this.map.widthInPixels;
    const mapH = this.map.heightInPixels;
    // Área visible real con zoom aplicado
    const visibleW = w / this.ZOOM;
    const visibleH = h / this.ZOOM;

    if (visibleW >= mapW && visibleH >= mapH) {
      // Viewport mayor que el mapa: centrar
      const offsetX = (visibleW - mapW) / 2;
      const offsetY = (visibleH - mapH) / 2;
      cam.setBounds(-offsetX, -offsetY, mapW + offsetX * 2, mapH + offsetY * 2);
      cam.stopFollow();
      cam.centerOn(mapW / 2, mapH / 2);
    } else {
      // Viewport menor: cámara sigue al jugador
      cam.setBounds(0, 0, mapW, mapH);
      cam.startFollow(this.player, true, 0.1, 0.1);
    }
  }

  // ─── Animaciones ───

  private createPlayerAnims() {
    if (this.anims.exists("walk-down")) return;

    this.anims.create({
      key: "walk-down",
      frames: this.anims.generateFrameNumbers("player-down", {
        start: 0,
        end: 5,
      }),
      frameRate: 10,
      repeat: -1,
    });
    this.anims.create({
      key: "walk-up",
      frames: this.anims.generateFrameNumbers("player-up", {
        start: 0,
        end: 5,
      }),
      frameRate: 10,
      repeat: -1,
    });
    this.anims.create({
      key: "walk-left",
      frames: this.anims.generateFrameNumbers("player-left", {
        start: 0,
        end: 5,
      }),
      frameRate: 10,
      repeat: -1,
    });
  }

  changeScene() {
    this.scene.start("GameOver");
  }
}
