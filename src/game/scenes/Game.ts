import { EventBus } from "../EventBus";
import { Scene } from "phaser";

interface NpcChoice {
  question: string;
  options: string[];
}

interface NpcData {
  id: string;
  sprite: Phaser.GameObjects.Sprite;
  tileX: number;
  tileY: number;
  tiles: { x: number; y: number }[];
  messages: string[] | (() => string[]);
  choice?: NpcChoice | (() => NpcChoice | undefined);
  walking?: boolean;
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

  // SCORM
  private learnerName = "";
  private learnerRole = "";
  private currentNpcId: string | null = null;
  private talkedTo = new Set<string>();

  // Equipo
  private teamSpawned = false;
  private teamDismissed = false;
  private teamWelcomeDone = false;
  private readonly teamNpcIds = ["nuria", "serena", "suvi", "diego"];
  private lastNpc1Choice: string | null = null;
  private singleTeamRespawn: string | null = null;
  private respawnTimeout: Phaser.Time.TimerEvent | null = null;
  private respawnedIds: string[] = [];

  // Diálogo
  private isTalking = false;
  private talkQueue: string[] = [];
  private talkIndex = 0;
  private dialogBg?: Phaser.GameObjects.Rectangle;
  private dialogText?: Phaser.GameObjects.Text;
  private dialogHint?: Phaser.GameObjects.Text;
  private keyEnter!: Phaser.Input.Keyboard.Key;
  private keySpace!: Phaser.Input.Keyboard.Key;

  // Choices
  private isChoosing = false;
  private choiceIndex = 0;
  private choiceTexts: Phaser.GameObjects.Text[] = [];
  private activeChoice: NpcChoice | null = null;

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

    this.load.tilemapTiledJSON("map", "assets/maps/map.json");
    this.load.image("dungeon", "assets/tilesets/tiles.png");

    this.load.spritesheet("player-up", "assets/characters/hero/hero_up.png", {
      frameWidth: 64,
      frameHeight: 64,
    });
    this.load.spritesheet(
      "player-down",
      "assets/characters/hero/hero_down.png",
      { frameWidth: 64, frameHeight: 64 }
    );
    this.load.spritesheet(
      "player-left",
      "assets/characters/hero/hero_side.png",
      { frameWidth: 64, frameHeight: 64 }
    );

    this.load.spritesheet(
      "npc1-down",
      "assets/characters/npc1/ncp1_down.png",
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
    this.spawnNpc(objLayer, "ncp1", "npc1-down", () => {
      if (!this.teamWelcomeDone) {
        return [
          "Hola, {name}.",
          "Bienvenido al mundo de Studio LXD.",
          "Voy a presentarte al equipo. ¡Espera un momento!",
        ];
      }
      return ["¡Hola de nuevo, {name}!", "¿Quieres que te presente a alguien?"];
    }, undefined, () => {
      if (!this.teamWelcomeDone) return undefined;
      return {
        question: "¿A quién quieres conocer?",
        options: ["Todo el equipo", "Nuria", "Serena", "Suvi", "Diego"],
      };
    });

    this.spawnNpc(objLayer, "ncp2", "npc1-down", () => {
      if (!this.talkedTo.has("ncp1")) {
        return [
          "¡Ey, {name}!",
          "Ve a hablar con el de ahí arriba.",
          "Te va a presentar al equipo.",
        ];
      }
      if (!this.allTeamTalkedTo()) {
        return [
          "¡Saluda al equipo!",
          "Están esperando para conocerte.",
        ];
      }
      if (this.learnerRole) {
        return [
          `¡Ey, {name}! Tu rol actual es: ${this.learnerRole}.`,
          "¿Te has equivocado? Puedes cambiarlo.",
        ];
      }
      return [
        "¡Ey, {name}! Ya conoces a todos.",
        "Antes de seguir, necesito saber algo...",
      ];
    }, { tileX: 17, tileY: 20 }, () => {
      if (!this.allTeamTalkedTo()) return undefined;
      if (this.learnerRole) {
        return {
          question: "¿Quieres cambiar tu rol? Perderás tu badge actual.",
          options: ["Mantener rol actual", "Diseñador instruccional", "Diseñador gráfico", "Programador"],
        };
      }
      return {
        question: "¿Cuál es tu rol en la empresa?",
        options: ["Diseñador instruccional", "Diseñador gráfico", "Programador"],
      };
    });

    const toolsByRole: Record<string, string[]> = {
      "Diseñador instruccional": [
        "Tus herramientas principales serán:",
        "- Articulate Storyline para e-learning",
        "- Miro para mapear experiencias",
        "- Notion para documentar diseños",
      ],
      "Diseñador gráfico": [
        "Tus herramientas principales serán:",
        "- Figma para diseño de interfaces",
        "- After Effects para animaciones",
        "- Illustrator para assets vectoriales",
      ],
      "Programador": [
        "Tus herramientas principales serán:",
        "- VS Code como editor principal",
        "- GitHub para control de versiones",
        "- Phaser para desarrollo de juegos",
      ],
    };

    this.spawnNpc(objLayer, "ncp3", "npc1-down", () => {
      if (!this.learnerRole) {
        return [
          "Hmm, aún no sé cuál es tu rol.",
          "Habla primero con mi compañero de allá arriba.",
        ];
      }
      return [
        `¡Así que eres ${this.learnerRole}! Genial.`,
        ...(toolsByRole[this.learnerRole] ?? ["¡Buena suerte en tu camino!"]),
      ];
    }, { tileX: 22, tileY: 24 });

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
          this.openDialog(npc);
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

    // SCORM: recibir datos del LMS
    EventBus.on("learner-name", (name: string) => {
      this.learnerName = name;
    });
    EventBus.on("restore-position", (pos: { tileX: number; tileY: number }) => {
      const x = pos.tileX * this.TILE + this.TILE / 2;
      const y = pos.tileY * this.TILE + this.TILE / 2;
      this.player.setPosition(x, y);
    });
    EventBus.on("restore-role", (rol: string) => {
      this.learnerRole = rol;
    });

    this.createAnims();
    EventBus.emit("current-scene-ready", this);

    // Pedir datos SCORM ahora que los listeners están registrados
    EventBus.emit("request-scorm-data");
  }

  update() {
    if (!this.player || !this.cursors) return;

    // --- Diálogo activo: bloquear movimiento ---
    if (this.isTalking) {
      if (this.isChoosing) {
        if (Phaser.Input.Keyboard.JustDown(this.cursors.up!)) {
          this.selectChoice(
            (this.choiceIndex - 1 + this.activeChoice!.options.length) %
              this.activeChoice!.options.length
          );
        } else if (Phaser.Input.Keyboard.JustDown(this.cursors.down!)) {
          this.selectChoice(
            (this.choiceIndex + 1) % this.activeChoice!.options.length
          );
        } else if (
          Phaser.Input.Keyboard.JustDown(this.keyEnter) ||
          Phaser.Input.Keyboard.JustDown(this.keySpace)
        ) {
          this.confirmChoice();
        }
      } else if (
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
        this.openDialog(adj);
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
        this.openDialog(npc);
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

        // Guardar posición en SCORM tras cada movimiento
        EventBus.emit("save-position", { tileX: tx, tileY: ty });

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
              this.openDialog(npc);
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
    fallbackMessages: string[] | (() => string[]),
    fallbackPos?: { tileX: number; tileY: number },
    choice?: NpcChoice | (() => NpcChoice | undefined)
  ) {
    const obj = objLayer?.objects.find((o) => o.name === objectName);
    if (!obj && !fallbackPos) return;

    const tileX = obj
      ? Math.floor((obj.x ?? 0) / this.TILE)
      : fallbackPos!.tileX;
    const tileY = obj
      ? Math.floor((obj.y ?? 0) / this.TILE)
      : fallbackPos!.tileY;

    const sprite = this.add.sprite(
      tileX * this.TILE + this.TILE / 2,
      tileY * this.TILE + this.TILE / 2,
      spriteKey,
      0
    );
    sprite.setScale(0.5);
    sprite.setDepth(10);

    // Leer mensajes desde Tiled (propiedad "messages" separada por |)
    const props = obj?.properties as
      | { name: string; value: unknown }[]
      | undefined;
    const raw = props?.find((p) => p.name === "messages")?.value as
      | string
      | undefined;
    const messages: string[] | (() => string[]) = raw
      ? raw
          .split("|")
          .map((s) => s.trim())
          .filter(Boolean)
      : fallbackMessages;

    const tiles = [{ x: tileX, y: tileY }];
    this.blocked.add(this.tileKey(tileX, tileY));
    this.npcs.set(objectName, { id: objectName, sprite, tileX, tileY, tiles, messages, choice });
  }

  /** Crea un NPC directamente en una posición (para NPCs dinámicos del equipo) */
  private spawnNpcAt(
    id: string,
    spriteKey: string,
    tileX: number,
    tileY: number,
    messages: string[] | (() => string[])
  ): NpcData {
    const sprite = this.add.sprite(
      tileX * this.TILE + this.TILE / 2,
      tileY * this.TILE + this.TILE / 2,
      spriteKey,
      0
    );
    sprite.setScale(0.5);
    sprite.setDepth(10);

    const npc: NpcData = {
      id,
      sprite,
      tileX,
      tileY,
      tiles: [{ x: tileX, y: tileY }],
      messages,
      walking: true,
    };
    this.blocked.add(this.tileKey(tileX, tileY));
    this.npcs.set(id, npc);
    return npc;
  }

  private getNpcAt(tileX: number, tileY: number): NpcData | null {
    for (const npc of this.npcs.values()) {
      if (npc.walking) continue;
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
      if (npc.walking) continue;
      if (this.isAdjacentToNpc(npc)) return npc;
    }
    return null;
  }

  // ─── Equipo ───

  private allTeamTalkedTo(): boolean {
    return this.teamNpcIds.every((id) => this.talkedTo.has(id));
  }

  private spawnTeam() {
    if (this.teamSpawned) return;
    this.teamSpawned = true;

    const ncp1 = this.npcs.get("ncp1");
    const baseX = ncp1 ? ncp1.tileX : 12;
    const baseY = ncp1 ? ncp1.tileY : 16;

    // Spawn justo fuera del borde derecho de la cámara
    const cam = this.cameras.main;
    const visibleRight = cam.midPoint.x + this.scale.width / (2 * this.ZOOM);
    const spawnX = Math.min(
      Math.ceil(visibleRight / this.TILE) + 2,
      this.map.width - 1
    );

    this.teamConfig.forEach((cfg, i) => {
      const destX = baseX + cfg.offsetX;
      const destY = baseY + cfg.offsetY;
      const spawnY = baseY - 1 + i;

      const npc = this.spawnNpcAt(cfg.id, "player-down", spawnX, spawnY, cfg.messages);

      this.time.delayedCall(i * 300, () => {
        const path = this.findPathForNpc(spawnX, spawnY, destX, destY, npc);
        if (path.length > 0) {
          this.walkNpcAlongPath(npc, path, () => {
            npc.walking = false;
          });
        } else {
          this.teleportNpc(npc, destX, destY);
          npc.walking = false;
        }
      });
    });
  }

  private dismissTeam() {
    if (this.teamDismissed) return;
    this.teamDismissed = true;

    // Salir justo fuera del borde derecho de la cámara
    const cam = this.cameras.main;
    const visibleRight = cam.midPoint.x + this.scale.width / (2 * this.ZOOM);
    const exitX = Math.min(
      Math.ceil(visibleRight / this.TILE) + 2,
      this.map.width - 1
    );

    this.teamNpcIds.forEach((id, i) => {
      const npc = this.npcs.get(id);
      if (!npc) return;

      npc.walking = true;

      this.time.delayedCall(i * 300, () => {
        const exitY = npc.tileY;
        const path = this.findPathForNpc(npc.tileX, npc.tileY, exitX, exitY, npc);
        if (path.length > 0) {
          this.walkNpcAlongPath(npc, path, () => {
            this.removeNpc(npc);
          });
        } else {
          this.removeNpc(npc);
        }
      });
    });
  }

  private readonly teamConfig: {
    id: string;
    offsetX: number;
    offsetY: number;
    messages: string[];
  }[] = [
    {
      id: "nuria",
      offsetX: 2,
      offsetY: -1,
      messages: [
        "¡Hola! Soy Nuria, diseñadora instruccional.",
        "Diseño experiencias de aprendizaje que enganchan.",
        "¡Encantada de conocerte, {name}!",
      ],
    },
    {
      id: "serena",
      offsetX: 2,
      offsetY: 1,
      messages: [
        "¡Hey! Soy Serena, también diseñadora instruccional.",
        "Me encanta crear contenido interactivo.",
        "¡Bienvenido/a al equipo!",
      ],
    },
    {
      id: "suvi",
      offsetX: -2,
      offsetY: -1,
      messages: [
        "¡Bienvenido/a! Soy Suvi, director y pedagogo.",
        "Mi trabajo es que todo tenga sentido educativo.",
        "Cualquier duda, aquí estoy.",
      ],
    },
    {
      id: "diego",
      offsetX: -2,
      offsetY: 1,
      messages: [
        "¡Qué tal! Soy Diego, socio y responsable de tecnología.",
        "Yo me encargo de que todo funcione.",
        "¡Cuenta conmigo para lo técnico!",
      ],
    },
  ];

  private respawnTeamMember(choice: string) {
    this.teamDismissed = false;

    // Cancelar timeout anterior si existe
    this.cancelRespawnTimeout();

    if (choice === "Todo el equipo") {
      this.teamSpawned = false;
      this.teamNpcIds.forEach((id) => this.talkedTo.delete(id));
      this.respawnedIds = [...this.teamNpcIds];
      this.spawnTeam();
    } else {
      const name = choice.toLowerCase();
      this.singleTeamRespawn = name;
      this.talkedTo.delete(name);
      this.respawnedIds = [name];
      this.spawnSingleTeamMember(name);
    }

    // 30s timeout: si no hablas con ellos, se van
    this.respawnTimeout = this.time.delayedCall(30000, () => {
      this.respawnTimeout = null;
      this.dismissRespawnedTeam();
    });
  }

  private cancelRespawnTimeout() {
    if (this.respawnTimeout) {
      this.respawnTimeout.destroy();
      this.respawnTimeout = null;
    }
  }

  private dismissRespawnedTeam() {
    const cam = this.cameras.main;
    const visibleRight = cam.midPoint.x + this.scale.width / (2 * this.ZOOM);
    const exitX = Math.min(
      Math.ceil(visibleRight / this.TILE) + 2,
      this.map.width - 1
    );

    // Solo dismiss los que aún no han sido hablados
    const remaining = this.respawnedIds.filter((id) => !this.talkedTo.has(id));
    remaining.forEach((id, i) => {
      const npc = this.npcs.get(id);
      if (!npc) return;

      npc.walking = true;

      this.time.delayedCall(i * 300, () => {
        const exitY = npc.tileY;
        const path = this.findPathForNpc(npc.tileX, npc.tileY, exitX, exitY, npc);
        if (path.length > 0) {
          this.walkNpcAlongPath(npc, path, () => {
            this.removeNpc(npc);
          });
        } else {
          this.removeNpc(npc);
        }
      });
    });

    this.singleTeamRespawn = null;
    this.respawnedIds = [];
  }

  private spawnSingleTeamMember(name: string) {
    const cfg = this.teamConfig.find((c) => c.id === name);
    if (!cfg) return;

    const ncp1 = this.npcs.get("ncp1");
    const baseX = ncp1 ? ncp1.tileX : 12;
    const baseY = ncp1 ? ncp1.tileY : 16;

    const destX = baseX + cfg.offsetX;
    const destY = baseY + cfg.offsetY;

    const cam = this.cameras.main;
    const visibleRight = cam.midPoint.x + this.scale.width / (2 * this.ZOOM);
    const spawnX = Math.min(
      Math.ceil(visibleRight / this.TILE) + 2,
      this.map.width - 1
    );
    const spawnY = baseY;

    const npc = this.spawnNpcAt(cfg.id, "player-down", spawnX, spawnY, cfg.messages);

    const path = this.findPathForNpc(spawnX, spawnY, destX, destY, npc);
    if (path.length > 0) {
      this.walkNpcAlongPath(npc, path, () => {
        npc.walking = false;
      });
    } else {
      this.teleportNpc(npc, destX, destY);
      npc.walking = false;
    }
  }

  private dismissSingleTeamMember(npcId: string) {
    const npc = this.npcs.get(npcId);
    if (!npc) return;

    npc.walking = true;

    const cam = this.cameras.main;
    const visibleRight = cam.midPoint.x + this.scale.width / (2 * this.ZOOM);
    const exitX = Math.min(
      Math.ceil(visibleRight / this.TILE) + 2,
      this.map.width - 1
    );
    const exitY = npc.tileY;

    const path = this.findPathForNpc(npc.tileX, npc.tileY, exitX, exitY, npc);
    if (path.length > 0) {
      this.walkNpcAlongPath(npc, path, () => {
        this.removeNpc(npc);
      });
    } else {
      this.removeNpc(npc);
    }
  }

  /** Solo desbloquea un tile si ningún otro NPC lo ocupa */
  private safeUnblock(tileX: number, tileY: number, excludeId: string) {
    const key = this.tileKey(tileX, tileY);
    for (const other of this.npcs.values()) {
      if (other.id === excludeId) continue;
      if (other.tiles.some((t) => this.tileKey(t.x, t.y) === key)) return;
    }
    this.blocked.delete(key);
  }

  private removeNpc(npc: NpcData) {
    this.npcs.delete(npc.id);
    this.safeUnblock(npc.tileX, npc.tileY, npc.id);
    npc.sprite.destroy();
  }

  private teleportNpc(npc: NpcData, tileX: number, tileY: number) {
    this.safeUnblock(npc.tileX, npc.tileY, npc.id);
    npc.tileX = tileX;
    npc.tileY = tileY;
    npc.tiles = [{ x: tileX, y: tileY }];
    npc.sprite.setPosition(
      tileX * this.TILE + this.TILE / 2,
      tileY * this.TILE + this.TILE / 2
    );
    this.blocked.add(this.tileKey(tileX, tileY));
  }

  /** Pathfinding que ignora el tile actual del NPC que se mueve */
  private findPathForNpc(
    sx: number, sy: number,
    ex: number, ey: number,
    npc: NpcData
  ): { x: number; y: number }[] {
    // Temporalmente desbloquear el tile del NPC
    const npcKey = this.tileKey(npc.tileX, npc.tileY);
    this.blocked.delete(npcKey);
    // También desbloquear destino si otro NPC lo ocupa temporalmente
    const destKey = this.tileKey(ex, ey);
    const destWasBlocked = this.blocked.has(destKey);
    this.blocked.delete(destKey);

    const path = this.findPath(sx, sy, ex, ey);

    // Restaurar
    this.blocked.add(npcKey);
    if (destWasBlocked) this.blocked.add(destKey);

    return path;
  }

  /** Mueve un NPC tile a tile a lo largo de un path */
  private walkNpcAlongPath(
    npc: NpcData,
    path: { x: number; y: number }[],
    onComplete?: () => void
  ) {
    if (path.length === 0) {
      onComplete?.();
      return;
    }

    const stepIndex = { value: 0 };

    const walkStep = () => {
      if (stepIndex.value >= path.length) {
        npc.sprite.anims.stop();
        onComplete?.();
        return;
      }

      const target = path[stepIndex.value];
      const dx = target.x - npc.tileX;
      const dy = target.y - npc.tileY;

      // Animación de dirección
      if (dx < 0) {
        npc.sprite.setFlipX(true);
        npc.sprite.anims.play("npc-walk-left", true);
      } else if (dx > 0) {
        npc.sprite.setFlipX(false);
        npc.sprite.anims.play("npc-walk-left", true);
      } else if (dy < 0) {
        npc.sprite.setFlipX(false);
        npc.sprite.anims.play("npc-walk-up", true);
      } else if (dy > 0) {
        npc.sprite.setFlipX(false);
        npc.sprite.anims.play("npc-walk-down", true);
      }

      // Desbloquear tile anterior (solo si no hay otro NPC), bloquear nuevo
      this.safeUnblock(npc.tileX, npc.tileY, npc.id);
      npc.tileX = target.x;
      npc.tileY = target.y;
      npc.tiles = [{ x: target.x, y: target.y }];
      this.blocked.add(this.tileKey(target.x, target.y));

      const destX = target.x * this.TILE + this.TILE / 2;
      const destY = target.y * this.TILE + this.TILE / 2;

      this.tweens.add({
        targets: npc.sprite,
        x: destX,
        y: destY,
        duration: this.MOVE_MS,
        onComplete: () => {
          npc.sprite.x = destX;
          npc.sprite.y = destY;
          stepIndex.value++;
          walkStep();
        },
      });
    };

    walkStep();
  }

  // ─── Diálogo ───

  private openDialog(npc: NpcData) {
    if (this.isTalking) return;

    this.isTalking = true;
    this.currentNpcId = npc.id;
    this.talkQueue = typeof npc.messages === "function" ? npc.messages() : npc.messages;
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
      .setResolution(this.ZOOM)
      .setScrollFactor(0)
      .setDepth(1001);

    this.dialogHint = this.add
      .text(hintPos.x, hintPos.y, "[Enter / Click]", {
        fontFamily: "monospace",
        fontSize: "4px",
        color: "#aaaaaa",
      })
      .setOrigin(1, 1)
      .setResolution(this.ZOOM)
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
    const line = (this.talkQueue[this.talkIndex] ?? "")
      .replace("{name}", this.learnerName || "aventurero");
    this.dialogText?.setText(line);
  }

  private advanceDialog() {
    if (this.isChoosing) {
      this.confirmChoice();
      return;
    }
    this.talkIndex++;
    if (this.talkIndex >= this.talkQueue.length) {
      // Si hay choices pendientes, mostrarlas
      const npc = this.currentNpcId ? this.npcs.get(this.currentNpcId) : null;
      const choice = npc?.choice;
      const resolvedChoice = typeof choice === "function" ? choice() : choice;
      if (resolvedChoice) {
        this.showChoices(resolvedChoice);
      } else {
        this.closeDialog();
      }
    } else {
      this.showLine();
    }
  }

  private showChoices(choice: NpcChoice) {
    this.isChoosing = true;
    this.activeChoice = choice;
    this.choiceIndex = 0;

    // Mostrar pregunta en el texto principal
    this.dialogText?.setText(choice.question);
    this.dialogHint?.setText("[↑↓] Elegir  [Enter] Confirmar");

    // Crear textos de opciones
    const z = this.ZOOM;
    const baseY = this.dialogText
      ? this.dialogText.y + 12
      : 0;

    this.choiceTexts = choice.options.map((opt, i) => {
      const text = this.add
        .text(this.dialogText!.x, baseY + i * 9, opt, {
          fontFamily: "monospace",
          fontSize: "6px",
          color: "#cccccc",
        })
        .setResolution(z)
        .setScrollFactor(0)
        .setDepth(1001);
      return text;
    });

    this.selectChoice(0);
  }

  private selectChoice(index: number) {
    this.choiceIndex = index;
    const opts = this.activeChoice!.options;
    for (let i = 0; i < this.choiceTexts.length; i++) {
      if (i === index) {
        this.choiceTexts[i].setText(`> ${opts[i]}`);
        this.choiceTexts[i].setColor("#ffffff");
      } else {
        this.choiceTexts[i].setText(`  ${opts[i]}`);
        this.choiceTexts[i].setColor("#888888");
      }
    }
  }

  private confirmChoice() {
    const choice = this.activeChoice!.options[this.choiceIndex];

    // Limpiar UI de choices
    this.choiceTexts.forEach((t) => t.destroy());
    this.choiceTexts = [];
    this.isChoosing = false;
    this.activeChoice = null;

    if (this.currentNpcId === "ncp1") {
      // NPC1: guardar elección de re-presentación
      this.lastNpc1Choice = choice;
      this.closeDialog();
      return;
    }

    if (this.currentNpcId === "ncp2") {
      if (this.learnerRole && choice === "Mantener rol actual") {
        // No cambiar nada
        this.closeDialog();
        return;
      }

      if (this.learnerRole) {
        // Cambio de rol: quitar badge anterior
        const oldBadgeId = `rol-${this.learnerRole.toLowerCase().replace(/ /g, "-")}`;
        EventBus.emit("badge-removed", { id: oldBadgeId });
      }

      // Asignar nuevo rol
      this.learnerRole = choice;
      EventBus.emit("choice-made", { npcId: this.currentNpcId, choice });
      EventBus.emit("badge-earned", {
        id: `rol-${choice.toLowerCase().replace(/ /g, "-")}`,
        name: choice,
        description: `Tu rol: ${choice}`,
      });
      this.closeDialog();
      return;
    }

    // Fallback para otros NPCs
    this.learnerRole = choice;
    EventBus.emit("choice-made", { npcId: this.currentNpcId, choice });
    EventBus.emit("badge-earned", {
      id: `rol-${choice.toLowerCase().replace(/ /g, "-")}`,
      name: choice,
      description: `Tu rol: ${choice}`,
    });
    this.closeDialog();
  }

  private closeDialog() {
    const closedNpcId = this.currentNpcId;

    // SCORM: emitir eventos al cerrar diálogo
    if (closedNpcId) {
      this.talkedTo.add(closedNpcId);
      EventBus.emit("npc-dialog-complete", closedNpcId);

      const tileX = Math.floor(this.player.x / this.TILE);
      const tileY = Math.floor(this.player.y / this.TILE);
      EventBus.emit("save-position", { tileX, tileY });

      if (this.talkedTo.size >= this.npcs.size) {
        EventBus.emit("course-complete");
      }
      this.currentNpcId = null;
    }

    this.isTalking = false;
    this.talkQueue = [];
    this.talkIndex = 0;

    this.dialogBg?.destroy();
    this.dialogText?.destroy();
    this.dialogHint?.destroy();
    this.dialogBg = undefined;
    this.dialogText = undefined;
    this.dialogHint = undefined;

    // Triggers post-diálogo
    if (closedNpcId === "ncp1-welcome") {
      EventBus.emit("badge-earned", {
        id: "team-member",
        name: "Miembro del equipo",
        description: "Has conocido a todo el equipo",
      });
    }
    if (closedNpcId === "ncp1" && !this.teamSpawned) {
      this.spawnTeam();
    }
    if (closedNpcId && this.teamNpcIds.includes(closedNpcId) && this.allTeamTalkedTo()) {
      this.dismissTeam();
      this.triggerTeamWelcome();
    }

    // NPC1 re-presentación: spawnar equipo o miembro individual
    if (closedNpcId === "ncp1" && this.teamWelcomeDone && this.lastNpc1Choice) {
      this.respawnTeamMember(this.lastNpc1Choice);
      this.lastNpc1Choice = null;
    }

    // Dismiss individual: si fue re-invocación individual, quitar al hablar
    if (closedNpcId && closedNpcId === this.singleTeamRespawn) {
      this.cancelRespawnTimeout();
      this.dismissSingleTeamMember(closedNpcId);
      this.singleTeamRespawn = null;
      this.respawnedIds = [];
    }

    // Re-spawn equipo completo: si ya hablaste con todos los re-invocados, cancelar timeout
    if (closedNpcId && this.respawnedIds.length > 0 && this.respawnedIds.includes(closedNpcId)) {
      const allRespawnedTalked = this.respawnedIds.every((id) => this.talkedTo.has(id));
      if (allRespawnedTalked) {
        this.cancelRespawnTimeout();
        this.respawnedIds = [];
      }
    }
  }

  private triggerTeamWelcome() {
    if (this.teamWelcomeDone) return;
    this.teamWelcomeDone = true;

    const ncp1 = this.npcs.get("ncp1");
    if (!ncp1) return;

    // NPC1 habla después de que el equipo empiece a irse
    this.time.delayedCall(1500, () => {
      // Forzar diálogo de NPC1 sin necesitar adyacencia
      this.isTalking = true;
      this.currentNpcId = "ncp1-welcome";
      this.talkQueue = [
        "¡Ya conoces a todo el equipo!",
        "Bienvenido/a oficialmente a Studio LXD, {name}.",
      ];
      this.talkIndex = 0;
      this.movePath = [];
      this.player.anims.stop();

      const z = this.ZOOM;
      const sw = this.scale.width;
      const sh = this.scale.height;
      const boxH = 40;
      const pad = 4;

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
        .setResolution(this.ZOOM)
        .setScrollFactor(0)
        .setDepth(1001);

      this.dialogHint = this.add
        .text(hintPos.x, hintPos.y, "[Enter / Click]", {
          fontFamily: "monospace",
          fontSize: "4px",
          color: "#aaaaaa",
        })
        .setOrigin(1, 1)
        .setResolution(this.ZOOM)
        .setScrollFactor(0)
        .setDepth(1001);

      this.showLine();
    });
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

  private createAnims() {
    if (this.anims.exists("walk-down")) return;

    // Animaciones del jugador
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

    // Animaciones de NPCs (mismos sprites que el hero)
    this.anims.create({
      key: "npc-walk-down",
      frames: this.anims.generateFrameNumbers("player-down", {
        start: 0,
        end: 5,
      }),
      frameRate: 10,
      repeat: -1,
    });
    this.anims.create({
      key: "npc-walk-up",
      frames: this.anims.generateFrameNumbers("player-up", {
        start: 0,
        end: 5,
      }),
      frameRate: 10,
      repeat: -1,
    });
    this.anims.create({
      key: "npc-walk-left",
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
