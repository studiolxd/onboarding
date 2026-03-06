import { EventBus } from "../EventBus";
import { Scene } from "phaser";
import { version } from "../../../package.json";
import { NpcChoice, NpcData, SceneTransitionData } from "../types";

export abstract class BaseScene extends Scene {
  protected cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  protected player!: Phaser.GameObjects.Sprite;
  protected walls!: Phaser.Tilemaps.TilemapLayer;
  protected map!: Phaser.Tilemaps.Tilemap;

  // Grid movement
  protected isMoving = false;
  protected movePath: { x: number; y: number }[] = [];
  protected cursor!: Phaser.GameObjects.Rectangle;
  protected blocked = new Set<number>();

  // NPCs
  protected npcs = new Map<string, NpcData>();
  protected pendingNpc: NpcData | null = null;

  // Shared state
  protected learnerName = "";
  protected learnerRole = "";
  protected displayName = "";
  protected genderPref: "masculino" | "femenino" | "neutro" | "" = "";
  protected currentNpcId: string | null = null;
  protected talkedTo = new Set<string>();

  // Progress
  protected visitedSuvi = false;
  protected visitedHr1 = false;
  protected visitedHr2 = false;
  protected visitedHr3 = false;

  // Dialog
  protected isTalking = false;
  protected talkQueue: string[] = [];
  protected talkIndex = 0;
  protected dialogBg?: Phaser.GameObjects.Rectangle;
  protected dialogText?: Phaser.GameObjects.Text;
  protected dialogHint?: Phaser.GameObjects.Text;
  protected keyEnter!: Phaser.Input.Keyboard.Key;
  protected keySpace!: Phaser.Input.Keyboard.Key;
  protected numKeys: Phaser.Input.Keyboard.Key[] = [];

  // Choices
  protected isChoosing = false;
  protected choiceIndex = 0;
  protected choiceTexts: Phaser.GameObjects.Text[] = [];
  protected activeChoice: NpcChoice | null = null;
  protected choiceScrollTop = 0;
  protected readonly MAX_VISIBLE_CHOICES = 4;
  protected readonly CHOICE_LINE_H = 18;
  protected arrowUp?: Phaser.GameObjects.Text;
  protected arrowDown?: Phaser.GameObjects.Text;
  private clickConsumed = false;

  // Cutscene lock — blocks all player input (movement, clicks, dialog)
  protected isInCutscene = false;

  /** Block all player input (movement, clicks, dialog). */
  protected startCutscene() { this.isInCutscene = true; this.cursor.setVisible(false); }

  /** Restore player input. */
  protected endCutscene() { this.isInCutscene = false; }

  // Dialog audio
  protected audioKeys: string[] = [];
  private currentAudio: HTMLAudioElement | null = null;
  private dialogAudioEnabled = true;
  protected sfxEnabled = true;

  // Text input
  protected isTypingName = false;
  protected typedNameBuffer = "";
  protected nameInputHandler?: (e: KeyboardEvent) => void;

  // Constants
  protected readonly TILE = 16;
  protected readonly MOVE_MS = 150;
  protected readonly ZOOM = 3;

  // ─── Utility ───

  protected tileKey(x: number, y: number) {
    return (y << 16) | x;
  }

  protected isTileBlocked(x: number, y: number) {
    return (
      !!this.walls.getTileAt(x, y) || this.blocked.has(this.tileKey(x, y))
    );
  }

  protected static readonly FALLBACK_NAME = "visitante";

  protected getName(): string {
    return this.displayName || this.learnerName || BaseScene.FALLBACK_NAME;
  }

  protected getGreeting(): string {
    const g = this.cache.json.get("common-dialogs").greeting;
    const template = this.genderPref === "masculino" ? g.m
      : this.genderPref === "femenino" ? g.f
      : this.genderPref === "neutro" ? g.n
      : g.default;
    return template.replace(/\{name\}/g, this.getName());
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected resolveGendered(data: any): any {
    if (data && typeof data === "object" && !Array.isArray(data) && ("m" in data || "f" in data || "n" in data)) {
      switch (this.genderPref) {
        case "masculino": return data.m;
        case "femenino": return data.f;
        case "neutro": return data.n;
        default: return data.m;
      }
    }
    return data;
  }

  /**
   * Recursively annotate string arrays in a dialog data object with audio path prefixes.
   * After calling this, each string[] will have `_audio` property set to `prefix/key`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected annotateAudio(obj: any, prefix: string) {
    if (!obj || typeof obj !== "object") return;
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (Array.isArray(val) && val.length > 0 && typeof val[0] === "string") {
        (val as any)._audio = `${prefix}-${key}`;
      } else if (val && typeof val === "object" && !Array.isArray(val)) {
        this.annotateAudio(val, `${prefix}-${key}`);
      }
    }
  }

  /** Extract audio keys from a messages array (uses _audio or _audioKeys annotation). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected audioKeysFrom(messages: any[]): string[] {
    // Explicit keys take priority (for concatenated arrays)
    const explicit = (messages as any)._audioKeys;
    if (explicit) return explicit;
    const prefix = (messages as any)._audio;
    if (!prefix) return [];
    return messages.map((_, i) => `${prefix}-${i}`);
  }

  /** Set talkQueue with matching audio keys from annotation, then show first line. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected setTalkWithAudio(messages: any[], startIndex = 0) {
    this.talkQueue = messages;
    this.audioKeys = this.audioKeysFrom(messages);
    this.talkIndex = startIndex;
    this.showLine();
  }

  /** Play dialog audio for the current line. */
  protected playDialogAudio() {
    this.stopDialogAudio();
    if (!this.dialogAudioEnabled) return;
    const key = this.audioKeys[this.talkIndex];
    if (!key) return;
    const audio = new Audio(`assets/audio/dialogs/${key}.mp3`);
    audio.onerror = () => {}; // silently ignore missing files
    audio.play().catch(() => {});
    this.currentAudio = audio;
  }

  /** Stop any currently playing dialog audio. */
  protected stopDialogAudio() {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
  }

  // ─── Setup helpers (called from concrete scene's create()) ───

  protected createMapAndPlayer() {
    this.map = this.make.tilemap({ key: "map" });

    const tileset = this.map.addTilesetImage("tileset", "dungeon");
    if (!tileset) throw new Error("No se pudo añadir el tileset.");

    const ground = this.map.createLayer("Ground", tileset, 0, 0);
    this.walls = this.map.createLayer("Walls", tileset, 0, 0)!;
    if (!ground || !this.walls)
      throw new Error("No se encontraron las capas Ground/Walls.");

    this.walls.setCollisionByExclusion([-1]);

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

    return objLayer;
  }

  protected setupCamera() {
    this.updateCamera(this.scale.width, this.scale.height);
    this.scale.on("resize", (gameSize: Phaser.Structs.Size) => {
      this.cameras.main.setViewport(0, 0, gameSize.width, gameSize.height);
      this.updateCamera(gameSize.width, gameSize.height);
      this.repositionDialog(gameSize.width, gameSize.height);
    });

    // Version text
    const verPos = this.screenToHUD(4 * this.ZOOM, 4 * this.ZOOM);
    this.add
      .text(verPos.x, verPos.y, `v${version}`, {
        fontFamily: "monospace",
        fontSize: "4px",
        color: "#666666",
      })
      .setResolution(this.ZOOM)
      .setScrollFactor(0)
      .setDepth(999);
  }

  protected setupInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keyEnter = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    this.keySpace = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    for (let i = 0; i < 9; i++) {
      this.numKeys.push(this.input.keyboard!.addKey(49 + i));
    }

    this.cursor = this.add
      .rectangle(0, 0, this.TILE, this.TILE)
      .setStrokeStyle(1, 0xffffff, 0.6)
      .setFillStyle(0xffffff, 0.15)
      .setDepth(5)
      .setVisible(false);

    this.input.on("pointerup", () => {
      this.cursor.setVisible(false);
    });

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (this.isTalking || this.isInCutscene) {
        this.cursor.setVisible(false);
        return;
      }

      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const tileX = Math.floor(world.x / this.TILE);
      const tileY = Math.floor(world.y / this.TILE);

      if (tileX < 0 || tileX >= this.map.width || tileY < 0 || tileY >= this.map.height) {
        this.cursor.setVisible(false);
        return;
      }

      this.cursor.setPosition(tileX * this.TILE + this.TILE / 2, tileY * this.TILE + this.TILE / 2);
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

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.clickConsumed) { this.clickConsumed = false; return; }
      if (this.isInCutscene) return;
      if (this.isTalking) {
        if (this.isTypingName) return;
        if (this.isChoosing) {
          this.handleChoiceClick(pointer);
        } else {
          this.advanceDialog();
        }
        return;
      }

      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const targetX = Math.floor(world.x / this.TILE);
      const targetY = Math.floor(world.y / this.TILE);

      const currentX = Math.floor(this.player.x / this.TILE);
      const currentY = Math.floor(this.player.y / this.TILE);

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

      this.pendingNpc = null;
      const path = this.findPath(currentX, currentY, targetX, targetY);
      if (path.length > 0) {
        this.movePath = path;
      }
    });
  }

  protected setupBaseEventListeners() {
    // Notify React of the current scene (important for initial scene)
    EventBus.emit("scene-changed", this.scene.key);

    // Emit task definitions from common-dialogs.json
    const commonData = this.cache.json.get("common-dialogs");
    if (commonData?.tasks) {
      EventBus.emit("task-defs-loaded", commonData.tasks);
    }

    const onLearnerName = (name: string) => {
      this.learnerName = name;
    };
    const onRestorePosition = (pos: { tileX: number; tileY: number }) => {
      const x = pos.tileX * this.TILE + this.TILE / 2;
      const y = pos.tileY * this.TILE + this.TILE / 2;
      this.player.setPosition(x, y);
    };
    const onRestoreRole = (rol: string) => {
      this.learnerRole = rol;
    };
    const onRestoreDisplayName = (name: string) => {
      this.displayName = name;
    };
    const onRestoreGender = (pref: "masculino" | "femenino" | "neutro") => {
      this.genderPref = pref;
    };
    const onRestoreTalkedTo = (ids: string[]) => {
      for (const id of ids) this.talkedTo.add(id);
    };
    const onRestoreProgress = (progress: { visitedSuvi?: boolean; visitedHr1?: boolean; visitedHr2?: boolean; visitedHr3?: boolean }) => {
      if (progress.visitedSuvi) this.visitedSuvi = true;
      if (progress.visitedHr1) this.visitedHr1 = true;
      if (progress.visitedHr2) this.visitedHr2 = true;
      if (progress.visitedHr3) this.visitedHr3 = true;
    };
    const onNavigateToScene = (sceneName: string) => {
      EventBus.emit("scene-changed", sceneName);
      this.scene.start(sceneName, this.getTransitionData());
    };
    const onSettingsChanged = (settings: { sfxEnabled: boolean; dialogAudioEnabled: boolean }) => {
      this.sfxEnabled = settings.sfxEnabled;
      this.dialogAudioEnabled = settings.dialogAudioEnabled;
      if (!this.dialogAudioEnabled) this.stopDialogAudio();
    };

    EventBus.on("learner-name", onLearnerName);
    EventBus.on("restore-position", onRestorePosition);
    EventBus.on("restore-role", onRestoreRole);
    EventBus.on("restore-display-name", onRestoreDisplayName);
    EventBus.on("restore-gender", onRestoreGender);
    EventBus.on("restore-talked-to", onRestoreTalkedTo);
    EventBus.on("restore-progress", onRestoreProgress);
    EventBus.on("navigate-to-scene", onNavigateToScene);
    EventBus.on("settings-changed", onSettingsChanged);

    // Cleanup on scene shutdown — only remove THIS scene's handlers
    this.events.on("shutdown", () => {
      // Reset dialog state
      this.stopDialogAudio();
      this.isTalking = false;
      this.talkQueue = [];
      this.talkIndex = 0;
      this.audioKeys = [];
      this.isChoosing = false;
      this.activeChoice = null;
      this.currentNpcId = null;
      this.isMoving = false;
      this.endCutscene();
      this.movePath = [];
      this.pendingNpc = null;

      // Hide React overlays
      this.input.keyboard!.enableGlobalCapture();
      EventBus.emit("hide-name-input");

      // Remove only this scene's EventBus listeners
      EventBus.off("learner-name", onLearnerName);
      EventBus.off("restore-position", onRestorePosition);
      EventBus.off("restore-role", onRestoreRole);
      EventBus.off("restore-display-name", onRestoreDisplayName);
      EventBus.off("restore-gender", onRestoreGender);
      EventBus.off("restore-talked-to", onRestoreTalkedTo);
      EventBus.off("restore-progress", onRestoreProgress);
      EventBus.off("navigate-to-scene", onNavigateToScene);
      EventBus.off("settings-changed", onSettingsChanged);
      EventBus.off("name-input-confirmed");
    });
  }

  protected getTransitionData(): SceneTransitionData {
    return {
      learnerName: this.learnerName,
      displayName: this.displayName,
      learnerRole: this.learnerRole,
      genderPref: this.genderPref,
      visitedSuvi: this.visitedSuvi,
      visitedHr1: this.visitedHr1,
      visitedHr2: this.visitedHr2,
      visitedHr3: this.visitedHr3,
      talkedTo: Array.from(this.talkedTo),
      fromScene: this.scene.key,
    };
  }

  protected restoreFromTransitionData(data: SceneTransitionData) {
    this.learnerName = data.learnerName;
    this.displayName = data.displayName;
    this.learnerRole = data.learnerRole;
    this.genderPref = data.genderPref;
    this.visitedSuvi = data.visitedSuvi;
    this.visitedHr1 = data.visitedHr1;
    this.visitedHr2 = data.visitedHr2;
    this.visitedHr3 = data.visitedHr3;
    for (const id of data.talkedTo) this.talkedTo.add(id);
  }

  // ─── Update ───

  update() {
    if (!this.player || !this.cursors) return;
    if (this.isInCutscene) return;

    if (this.isTalking) {
      if (this.isTypingName) return;
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
        } else {
          for (let i = 0; i < this.numKeys.length && i < this.activeChoice!.options.length; i++) {
            if (Phaser.Input.Keyboard.JustDown(this.numKeys[i])) {
              this.selectChoice(i);
              this.confirmChoice();
              break;
            }
          }
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

    if (Phaser.Input.Keyboard.JustDown(this.keyEnter) || Phaser.Input.Keyboard.JustDown(this.keySpace)) {
      const adj = this.getAdjacentNpc();
      if (adj) {
        this.openDialog(adj);
        return;
      }
    }

    let dx = 0;
    let dy = 0;

    if (this.cursors.left?.isDown) { dx = -1; this.movePath = []; }
    else if (this.cursors.right?.isDown) { dx = 1; this.movePath = []; }
    else if (this.cursors.up?.isDown) { dy = -1; this.movePath = []; }
    else if (this.cursors.down?.isDown) { dy = 1; this.movePath = []; }
    else if (this.movePath.length > 0) {
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

    if (tx < 0 || tx >= this.map.width || ty < 0 || ty >= this.map.height) return;

    if (this.isTileBlocked(tx, ty)) {
      this.movePath = [];
      this.player.anims.stop();
      const npc = this.getNpcAt(tx, ty);
      if (npc) this.openDialog(npc);
      return;
    }

    if (dx < 0) { this.player.setFlipX(true); this.player.anims.play("walk-left", true); }
    else if (dx > 0) { this.player.setFlipX(false); this.player.anims.play("walk-left", true); }
    else if (dy < 0) { this.player.setFlipX(false); this.player.anims.play("walk-up", true); }
    else if (dy > 0) { this.player.setFlipX(false); this.player.anims.play("walk-down", true); }

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

  protected spawnNpc(
    objLayer: Phaser.Tilemaps.ObjectLayer | null,
    objectName: string,
    spriteKey: string,
    fallbackMessages: string[] | (() => string[]),
    fallbackPos?: { tileX: number; tileY: number },
    choice?: NpcChoice | (() => NpcChoice | undefined)
  ) {
    const obj = objLayer?.objects.find((o) => o.name === objectName);
    if (!obj && !fallbackPos) return;

    const tileX = obj ? Math.floor((obj.x ?? 0) / this.TILE) : fallbackPos!.tileX;
    const tileY = obj ? Math.floor((obj.y ?? 0) / this.TILE) : fallbackPos!.tileY;

    const sprite = this.add.sprite(
      tileX * this.TILE + this.TILE / 2,
      tileY * this.TILE + this.TILE / 2,
      spriteKey, 0
    );
    sprite.setScale(0.5);
    sprite.setDepth(10);

    const props = obj?.properties as { name: string; value: unknown }[] | undefined;
    const raw = props?.find((p) => p.name === "messages")?.value as string | undefined;
    const messages: string[] | (() => string[]) = raw
      ? raw.split("|").map((s) => s.trim()).filter(Boolean)
      : fallbackMessages;

    const tiles = [{ x: tileX, y: tileY }];
    this.blocked.add(this.tileKey(tileX, tileY));
    this.npcs.set(objectName, { id: objectName, sprite, tileX, tileY, tiles, messages, choice });
  }

  protected spawnNpcAt(
    id: string,
    spriteKey: string,
    tileX: number,
    tileY: number,
    messages: string[] | (() => string[]),
    choice?: NpcChoice | (() => NpcChoice | undefined)
  ): NpcData {
    const sprite = this.add.sprite(
      tileX * this.TILE + this.TILE / 2,
      tileY * this.TILE + this.TILE / 2,
      spriteKey, 0
    );
    sprite.setScale(0.5);
    sprite.setDepth(10);

    const npc: NpcData = { id, sprite, tileX, tileY, tiles: [{ x: tileX, y: tileY }], messages, choice, walking: true };
    this.blocked.add(this.tileKey(tileX, tileY));
    this.npcs.set(id, npc);
    return npc;
  }

  protected getNpcAt(tileX: number, tileY: number): NpcData | null {
    for (const npc of this.npcs.values()) {
      if (npc.walking) continue;
      if (npc.tiles.some((t) => t.x === tileX && t.y === tileY)) return npc;
    }
    return null;
  }

  protected isAdjacentToNpc(npc: NpcData): boolean {
    const px = Math.floor(this.player.x / this.TILE);
    const py = Math.floor(this.player.y / this.TILE);
    const npcTiles = new Set(npc.tiles.map((t) => this.tileKey(t.x, t.y)));
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      if (npcTiles.has(this.tileKey(px + dx, py + dy))) return true;
    }
    return false;
  }

  protected findAdjacentFree(npc: NpcData): { x: number; y: number } | null {
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
          if (dist < bestDist) { bestDist = dist; best = { x: nx, y: ny }; }
        }
      }
    }
    return best;
  }

  protected getAdjacentNpc(): NpcData | null {
    for (const npc of this.npcs.values()) {
      if (npc.walking) continue;
      if (this.isAdjacentToNpc(npc)) return npc;
    }
    return null;
  }

  protected safeUnblock(tileX: number, tileY: number, excludeId: string) {
    const key = this.tileKey(tileX, tileY);
    for (const other of this.npcs.values()) {
      if (other.id === excludeId) continue;
      if (other.tiles.some((t) => this.tileKey(t.x, t.y) === key)) return;
    }
    this.blocked.delete(key);
  }

  protected removeNpc(npc: NpcData) {
    this.npcs.delete(npc.id);
    this.safeUnblock(npc.tileX, npc.tileY, npc.id);
    npc.sprite.destroy();
  }

  protected teleportNpc(npc: NpcData, tileX: number, tileY: number) {
    this.safeUnblock(npc.tileX, npc.tileY, npc.id);
    npc.tileX = tileX;
    npc.tileY = tileY;
    npc.tiles = [{ x: tileX, y: tileY }];
    npc.sprite.setPosition(tileX * this.TILE + this.TILE / 2, tileY * this.TILE + this.TILE / 2);
    this.blocked.add(this.tileKey(tileX, tileY));
  }

  protected findPathForNpc(sx: number, sy: number, ex: number, ey: number, npc: NpcData): { x: number; y: number }[] {
    const npcKey = this.tileKey(npc.tileX, npc.tileY);
    this.blocked.delete(npcKey);
    const destKey = this.tileKey(ex, ey);
    const destWasBlocked = this.blocked.has(destKey);
    this.blocked.delete(destKey);

    const playerTileX = Math.floor(this.player.x / this.TILE);
    const playerTileY = Math.floor(this.player.y / this.TILE);
    const playerKey = this.tileKey(playerTileX, playerTileY);
    const playerWasBlocked = this.blocked.has(playerKey);
    this.blocked.add(playerKey);

    const path = this.findPath(sx, sy, ex, ey);

    this.blocked.add(npcKey);
    if (destWasBlocked) this.blocked.add(destKey);
    if (!playerWasBlocked) this.blocked.delete(playerKey);

    return path;
  }

  protected walkNpcAlongPath(npc: NpcData, path: { x: number; y: number }[], onComplete?: () => void) {
    if (path.length === 0) { onComplete?.(); return; }

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

      if (dx < 0) { npc.sprite.setFlipX(true); npc.sprite.anims.play("npc-walk-left", true); }
      else if (dx > 0) { npc.sprite.setFlipX(false); npc.sprite.anims.play("npc-walk-left", true); }
      else if (dy < 0) { npc.sprite.setFlipX(false); npc.sprite.anims.play("npc-walk-up", true); }
      else if (dy > 0) { npc.sprite.setFlipX(false); npc.sprite.anims.play("npc-walk-down", true); }

      this.safeUnblock(npc.tileX, npc.tileY, npc.id);
      npc.tileX = target.x;
      npc.tileY = target.y;
      npc.tiles = [{ x: target.x, y: target.y }];
      this.blocked.add(this.tileKey(target.x, target.y));

      const destX = target.x * this.TILE + this.TILE / 2;
      const destY = target.y * this.TILE + this.TILE / 2;

      this.tweens.add({
        targets: npc.sprite,
        x: destX, y: destY,
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

  protected walkPlayerAlongPath(path: { x: number; y: number }[], onComplete?: () => void) {
    if (path.length === 0) { onComplete?.(); return; }

    this.isTalking = true;
    this.movePath = [];
    const stepIndex = { value: 0 };

    const walkStep = () => {
      if (stepIndex.value >= path.length) {
        this.player.anims.stop();
        onComplete?.();
        return;
      }

      const target = path[stepIndex.value];
      const cx = Math.floor(this.player.x / this.TILE);
      const cy = Math.floor(this.player.y / this.TILE);
      const dx = target.x - cx;
      const dy = target.y - cy;

      if (dx < 0) { this.player.setFlipX(true); this.player.anims.play("walk-left", true); }
      else if (dx > 0) { this.player.setFlipX(false); this.player.anims.play("walk-left", true); }
      else if (dy < 0) { this.player.setFlipX(false); this.player.anims.play("walk-up", true); }
      else if (dy > 0) { this.player.setFlipX(false); this.player.anims.play("walk-down", true); }

      const destX = target.x * this.TILE + this.TILE / 2;
      const destY = target.y * this.TILE + this.TILE / 2;

      this.tweens.add({
        targets: this.player,
        x: destX, y: destY,
        duration: this.MOVE_MS,
        onComplete: () => {
          this.player.x = destX;
          this.player.y = destY;
          stepIndex.value++;
          walkStep();
        },
      });
    };

    walkStep();
  }

  protected getOffscreenRight(): number {
    const cam = this.cameras.main;
    const visibleRight = cam.midPoint.x + this.scale.width / (2 * this.ZOOM);
    return Math.min(Math.ceil(visibleRight / this.TILE) + 2, this.map.width - 1);
  }

  protected getOffscreenLeft(): number {
    const cam = this.cameras.main;
    const visibleLeft = cam.midPoint.x - this.scale.width / (2 * this.ZOOM);
    return Math.max(Math.floor(visibleLeft / this.TILE) - 2, 0);
  }

  /**
   * Build an exit path to the right that avoids NPCs using pathfinding.
   * @param fromX    starting tile X
   * @param fromY    starting tile Y
   * @param excludeIds NPC ids that are exiting too (unblocked during pathfinding)
   */
  protected buildExitPathRight(fromX: number, fromY: number, excludeIds: string[] = []): { x: number; y: number }[] {
    const exitX = this.getOffscreenRight();

    // Temporarily unblock NPCs that are exiting with us
    const reblock: number[] = [];
    for (const id of excludeIds) {
      const npc = this.npcs.get(id);
      if (npc) {
        const key = this.tileKey(npc.tileX, npc.tileY);
        if (this.blocked.has(key)) {
          this.blocked.delete(key);
          reblock.push(key);
        }
      }
    }

    // Also unblock the player's own tile
    const playerKey = this.tileKey(fromX, fromY);
    const playerWasBlocked = this.blocked.has(playerKey);
    this.blocked.delete(playerKey);

    // Find a reachable tile near the right edge of the map
    let path: { x: number; y: number }[] = [];
    for (let x = exitX; x > fromX && path.length === 0; x--) {
      for (let dy = 0; dy <= 5 && path.length === 0; dy++) {
        for (const sign of dy === 0 ? [0] : [-1, 1]) {
          const ty = fromY + sign * dy;
          if (ty < 0 || ty >= this.map.height) continue;
          if (this.isTileBlocked(x, ty)) continue;
          path = this.findPath(fromX, fromY, x, ty);
          if (path.length > 0) break;
        }
      }
    }

    // Re-block
    for (const key of reblock) this.blocked.add(key);
    if (playerWasBlocked) this.blocked.add(playerKey);

    // Extend path straight to offscreen
    const lastX = path.length > 0 ? path[path.length - 1].x : fromX;
    const lastY = path.length > 0 ? path[path.length - 1].y : fromY;
    for (let x = lastX + 1; x <= exitX; x++) {
      path.push({ x, y: lastY });
    }

    // Fallback: straight line if pathfinding failed entirely
    if (path.length === 0) {
      for (let x = fromX + 1; x <= exitX; x++) {
        path.push({ x, y: fromY });
      }
    }

    return path;
  }

  // ─── Dialog ───

  protected openDialog(npc: NpcData) {
    if (this.isTalking) return;

    this.isTalking = true;
    this.cursor.setVisible(false);
    this.currentNpcId = npc.id;
    const msgs = typeof npc.messages === "function" ? npc.messages() : npc.messages;
    this.talkQueue = msgs;
    this.audioKeys = this.audioKeysFrom(msgs);
    this.talkIndex = 0;
    this.movePath = [];
    this.player.anims.stop();

    const z = this.ZOOM;
    const sw = this.scale.width;
    const sh = this.scale.height;
    const boxH = 100;
    const pad = 4;

    const bgPos = this.screenToHUD(0, sh - boxH * z);
    const textPos = this.screenToHUD(pad * z, sh - boxH * z + pad * z);
    const hintPos = this.screenToHUD(sw - pad * z, sh - pad * z);

    this.dialogBg = this.add
      .rectangle(bgPos.x, bgPos.y, sw / z, boxH, 0x000000, 0.85)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(1000);

    this.dialogText = this.add
      .text(textPos.x, textPos.y, "", {
        fontFamily: "monospace", fontSize: "7px", color: "#ffffff",
        wordWrap: { width: sw / z - pad * 2 },
      })
      .setResolution(this.ZOOM).setScrollFactor(0).setDepth(1001);

    this.dialogHint = this.add
      .text(hintPos.x, hintPos.y, "[Enter / Click]", {
        fontFamily: "monospace", fontSize: "4px", color: "#aaaaaa",
      })
      .setOrigin(1, 1).setResolution(this.ZOOM).setScrollFactor(0).setDepth(1001);

    if (this.talkQueue.length === 0) {
      const choice = npc.choice;
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

  /** Opens a forced dialog without needing adjacency (e.g. for welcome/finale sequences) */
  protected openForcedDialog(npcId: string, messages: string[], audioKeys?: string[]) {
    // Close any existing dialog to avoid stacking
    if (this.isTalking) {
      this.dialogBg?.destroy();
      this.dialogText?.destroy();
      this.dialogHint?.destroy();
      this.dialogBg = undefined;
      this.dialogText = undefined;
      this.dialogHint = undefined;
      this.choiceTexts.forEach((t) => t.destroy());
      this.choiceTexts = [];
      this.destroyArrows();
    }

    this.isTalking = true;
    this.currentNpcId = npcId;
    this.talkQueue = messages;
    this.audioKeys = audioKeys ?? this.audioKeysFrom(messages);
    this.talkIndex = 0;
    this.movePath = [];
    this.player.anims.stop();

    const z = this.ZOOM;
    const sw = this.scale.width;
    const sh = this.scale.height;
    const boxH = 100;
    const pad = 4;

    const bgPos = this.screenToHUD(0, sh - boxH * z);
    const textPos = this.screenToHUD(pad * z, sh - boxH * z + pad * z);
    const hintPos = this.screenToHUD(sw - pad * z, sh - pad * z);

    this.dialogBg = this.add
      .rectangle(bgPos.x, bgPos.y, sw / z, boxH, 0x000000, 0.85)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(1000);

    this.dialogText = this.add
      .text(textPos.x, textPos.y, "", {
        fontFamily: "monospace", fontSize: "7px", color: "#ffffff",
        wordWrap: { width: sw / z - pad * 2 },
      })
      .setResolution(this.ZOOM).setScrollFactor(0).setDepth(1001);

    this.dialogHint = this.add
      .text(hintPos.x, hintPos.y, "[Enter / Click]", {
        fontFamily: "monospace", fontSize: "4px", color: "#aaaaaa",
      })
      .setOrigin(1, 1).setResolution(this.ZOOM).setScrollFactor(0).setDepth(1001);

    this.showLine();
  }

  protected repositionDialog(w: number, h: number) {
    if (!this.isTalking) return;
    const z = this.ZOOM;
    const boxH = 100;
    const pad = 4;

    const bgPos = this.screenToHUD(0, h - boxH * z);
    const textPos = this.screenToHUD(pad * z, h - boxH * z + pad * z);
    const hintPos = this.screenToHUD(w - pad * z, h - pad * z);

    this.dialogBg?.setPosition(bgPos.x, bgPos.y).setSize(w / z, boxH);
    this.dialogText?.setPosition(textPos.x, textPos.y);
    this.dialogText?.setWordWrapWidth(w / z - pad * 2);
    this.dialogHint?.setPosition(hintPos.x, hintPos.y);
  }

  protected resolveText(text: string): string {
    return text
      .replace(/\{name\}/g, this.getName())
      .replace(/\{scormName\}/g, this.learnerName || BaseScene.FALLBACK_NAME)
      .replace(/\{greeting\}/g, this.getGreeting())
      .replace(/\{role\}/g, this.learnerRole || "");
  }

  protected resolveMessages(messages: string[]): string[] {
    return messages.map(m => this.resolveText(m));
  }

  protected showLine() {
    const line = this.resolveText(this.talkQueue[this.talkIndex] ?? "");
    this.dialogText?.setText(line);
    this.playDialogAudio();
  }

  protected advanceDialog() {
    if (this.isChoosing) { this.confirmChoice(); return; }
    this.talkIndex++;
    if (this.talkIndex >= this.talkQueue.length) {
      const npc = this.currentNpcId ? this.npcs.get(this.currentNpcId) : null;
      const choice = npc?.choice;
      const resolvedChoice = typeof choice === "function" ? choice() : choice;
      if (resolvedChoice) {
        this.stopDialogAudio();
        this.showChoices(resolvedChoice);
      } else {
        this.closeDialog();
      }
    } else {
      this.showLine();
    }
  }

  protected showChoices(choice: NpcChoice) {
    this.isChoosing = true;
    this.activeChoice = {
      question: this.resolveText(choice.question),
      options: choice.options.map(o => this.resolveText(o)),
    };
    this.choiceIndex = 0;
    this.choiceScrollTop = 0;

    this.dialogText?.setText(this.activeChoice.question);
    this.dialogHint?.setText(this.cache.json.get("common-dialogs").choiceHint);

    const baseY = this.dialogText ? this.dialogText.y + this.dialogText.height + 4 : 0;
    const visibleCount = Math.min(choice.options.length, this.MAX_VISIBLE_CHOICES);
    this.choiceTexts = [];
    for (let i = 0; i < visibleCount; i++) {
      const slot = i;
      const wrapWidth = this.dialogBg ? this.dialogBg.width - 16 : 200;
      const text = this.add
        .text(this.dialogText!.x, baseY + i * this.CHOICE_LINE_H, "", {
          fontFamily: "monospace", fontSize: "7px", color: "#cccccc",
          padding: { top: 3, bottom: 3 },
          wordWrap: { width: wrapWidth },
        })
        .setResolution(this.ZOOM).setScrollFactor(0).setDepth(1001)
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", () => {
          this.clickConsumed = true;
          const optIdx = this.choiceScrollTop + slot;
          if (optIdx < this.activeChoice!.options.length) {
            this.selectChoice(optIdx);
            this.confirmChoice();
          }
        });
      this.choiceTexts.push(text);
    }

    {
      const arrowX = this.dialogBg ? this.dialogBg.x + this.dialogBg.width - 8 : this.dialogText!.x + 80;
      const arrowPad = 6;

      this.arrowUp = this.add
        .text(arrowX, baseY - arrowPad, "▲", { fontFamily: "monospace", fontSize: "8px", color: "#666666", padding: { top: 2, bottom: 2, left: 2, right: 2 } })
        .setResolution(this.ZOOM).setScrollFactor(0).setDepth(1001)
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", () => { this.clickConsumed = true; if (this.choiceIndex > 0) this.selectChoice(this.choiceIndex - 1); });

      const lastSlotY = baseY + (visibleCount - 1) * this.CHOICE_LINE_H;
      this.arrowDown = this.add
        .text(arrowX, lastSlotY + this.CHOICE_LINE_H + arrowPad, "▼", { fontFamily: "monospace", fontSize: "8px", color: "#666666", padding: { top: 2, bottom: 2, left: 2, right: 2 } })
        .setResolution(this.ZOOM).setScrollFactor(0).setDepth(1001)
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", () => { this.clickConsumed = true; if (this.choiceIndex < this.activeChoice!.options.length - 1) this.selectChoice(this.choiceIndex + 1); });
    }

    this.selectChoice(0);
  }

  protected selectChoice(index: number) {
    this.choiceIndex = index;
    const opts = this.activeChoice!.options;
    const total = opts.length;
    const maxVis = this.MAX_VISIBLE_CHOICES;

    if (index < this.choiceScrollTop) this.choiceScrollTop = index;
    else if (index >= this.choiceScrollTop + maxVis) this.choiceScrollTop = index - maxVis + 1;

    const baseY = this.dialogText ? this.dialogText.y + this.dialogText.height + 4 : 0;
    let curY = baseY;
    for (let slot = 0; slot < this.choiceTexts.length; slot++) {
      const optIdx = this.choiceScrollTop + slot;
      if (optIdx >= total) { this.choiceTexts[slot].setText(""); continue; }
      const num = `${optIdx + 1}. `;
      const prefix = optIdx === index ? "> " : "  ";
      const color = optIdx === index ? "#ffffff" : "#888888";
      this.choiceTexts[slot].setText(prefix + num + opts[optIdx]);
      this.choiceTexts[slot].setColor(color);
      this.choiceTexts[slot].setY(curY);
      curY += this.choiceTexts[slot].height + 2;
    }

    if (this.arrowUp) this.arrowUp.setColor(index > 0 ? "#ffffff" : "#444444");
    if (this.arrowDown) {
      this.arrowDown.setColor(index < total - 1 ? "#ffffff" : "#444444");
      this.arrowDown.setY(curY + 4);
    }
  }

  protected destroyArrows() {
    this.arrowUp?.destroy();
    this.arrowDown?.destroy();
    this.arrowUp = undefined;
    this.arrowDown = undefined;
  }

  protected handleChoiceClick(_pointer: Phaser.Input.Pointer) {
    // Choices are handled via interactive text objects directly
  }

  protected confirmChoice() {
    const choice = this.activeChoice!.options[this.choiceIndex];
    const npcId = this.currentNpcId;

    this.choiceTexts.forEach((t) => t.destroy());
    this.choiceTexts = [];
    this.destroyArrows();

    this.isChoosing = false;
    this.activeChoice = null;

    // Let the concrete scene handle it
    if (npcId && this.onChoiceConfirmed(npcId, choice)) return;

    // Fallback: close dialog
    this.closeDialog();
  }

  protected startTextInput() {
    this.isTypingName = true;
    this.dialogText?.setText("Escribe tu nombre abajo...");
    this.dialogHint?.setText("");

    this.input.keyboard!.disableGlobalCapture();
    EventBus.emit("show-name-input");

    // Listen for confirmed name from React
    const onNameConfirmed = (name: string) => {
      EventBus.off("name-input-confirmed", onNameConfirmed);
      this.stopTextInput();
      this.displayName = name;
      EventBus.emit("name-changed", this.displayName);
      this.onNameConfirmed(this.displayName);
    };
    EventBus.on("name-input-confirmed", onNameConfirmed);

    // Store handler ref for cleanup
    this.nameInputHandler = (() => {
      EventBus.off("name-input-confirmed", onNameConfirmed);
    }) as unknown as (e: KeyboardEvent) => void;
  }

  protected stopTextInput() {
    this.isTypingName = false;
    if (this.nameInputHandler) {
      (this.nameInputHandler as unknown as () => void)();
      this.nameInputHandler = undefined;
    }
    this.input.keyboard!.enableGlobalCapture();
    EventBus.emit("hide-name-input");
  }

  protected closeDialog() {
    const closedNpcId = this.currentNpcId;

    if (closedNpcId) {
      this.talkedTo.add(closedNpcId);
      EventBus.emit("talked-to-updated", Array.from(this.talkedTo));
      EventBus.emit("npc-dialog-complete", closedNpcId);

      const tileX = Math.floor(this.player.x / this.TILE);
      const tileY = Math.floor(this.player.y / this.TILE);
      EventBus.emit("save-position", { tileX, tileY });

      this.currentNpcId = null;
    }

    this.isTalking = false;
    this.talkQueue = [];
    this.talkIndex = 0;
    this.audioKeys = [];
    this.stopDialogAudio();

    this.dialogBg?.destroy();
    this.dialogText?.destroy();
    this.dialogHint?.destroy();
    this.dialogBg = undefined;
    this.dialogText = undefined;
    this.dialogHint = undefined;

    this.choiceTexts.forEach((t) => t.destroy());
    this.choiceTexts = [];
    this.destroyArrows();

    this.stopTextInput();
    this.isChoosing = false;
    this.activeChoice = null;

    // Let concrete scene handle post-dialog triggers
    if (closedNpcId) this.onDialogClosed(closedNpcId);
  }

  // ─── Hooks for concrete scenes ───

  /** Override to handle choice confirmation. Return true if handled. */
  protected onChoiceConfirmed(_npcId: string, _choice: string): boolean {
    return false;
  }

  /** Override to handle post-dialog triggers. */
  protected onDialogClosed(_npcId: string): void {
    // no-op
  }

  /** Override to handle name confirmation after text input. */
  protected onNameConfirmed(_name: string): void {
    // no-op
  }

  // ─── Pathfinding A* ───

  protected findPath(sx: number, sy: number, ex: number, ey: number): { x: number; y: number }[] {
    if (ex < 0 || ex >= this.map.width || ey < 0 || ey >= this.map.height) return [];
    if (this.isTileBlocked(ex, ey)) return [];

    type Node = { x: number; y: number; g: number; f: number; parent: Node | null };

    const key = (x: number, y: number) => (y << 16) | x;
    const h = (x: number, y: number) => Math.abs(x - ex) + Math.abs(y - ey);

    const open: Node[] = [{ x: sx, y: sy, g: 0, f: h(sx, sy), parent: null }];
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
        while (n?.parent) { path.unshift({ x: n.x, y: n.y }); n = n.parent; }
        return path;
      }

      closed.add(key(cur.x, cur.y));

      for (const [nx, ny] of [[cur.x - 1, cur.y], [cur.x + 1, cur.y], [cur.x, cur.y - 1], [cur.x, cur.y + 1]]) {
        if (nx < 0 || nx >= this.map.width || ny < 0 || ny >= this.map.height) continue;
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

  protected screenToHUD(sx: number, sy: number): { x: number; y: number } {
    const z = this.ZOOM;
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    return { x: (sx - cx) / z + cx, y: (sy - cy) / z + cy };
  }

  protected updateCamera(w: number, h: number) {
    const cam = this.cameras.main;
    cam.setZoom(this.ZOOM);

    const mapW = this.map.widthInPixels;
    const mapH = this.map.heightInPixels;
    const visibleW = w / this.ZOOM;
    const visibleH = h / this.ZOOM;

    if (visibleW >= mapW && visibleH >= mapH) {
      const offsetX = (visibleW - mapW) / 2;
      const offsetY = (visibleH - mapH) / 2;
      cam.setBounds(-offsetX, -offsetY, mapW + offsetX * 2, mapH + offsetY * 2);
      cam.stopFollow();
      cam.centerOn(mapW / 2, mapH / 2);
    } else {
      cam.setBounds(0, 0, mapW, mapH);
      cam.startFollow(this.player, true, 0.1, 0.1);
    }
  }
}
