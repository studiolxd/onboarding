import { EventBus } from "../EventBus";
import { BaseScene } from "./BaseScene";
import { SceneTransitionData } from "../types";

export class ITScene extends BaseScene {
  private visitedIT = false;
  private fromScene: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private d: any;

  constructor() {
    super("ITScene");
  }

  init(data?: SceneTransitionData) {
    if (data && data.learnerName) {
      this.restoreFromTransitionData(data);
      this.fromScene = data.fromScene || null;
    }
  }

  create() {
    const objLayer = this.createMapAndPlayer();
    this.setupCamera();
    this.setupInput();
    this.setupBaseEventListeners();

    this.d = this.cache.json.get("it-dialogs")["it-npc"];

    this.spawnNpc(objLayer, "it-npc", "npc1-down", () => {
      if (!this.visitedIT) {
        return this.resolveGendered(this.d.firstVisit);
      }
      return this.d.returnVisit;
    }, { tileX: 4, tileY: 18 }, () => {
      if (!this.visitedIT) {
        return this.d.firstChoice;
      }
      return undefined;
    });

    EventBus.emit("current-scene-ready", this);
    EventBus.emit("request-scorm-data");

    if (this.fromScene === "HRScene") {
      this.playSuviEntrance();
    }
  }

  private playSuviEntrance() {
    const playerTileX = Math.floor(this.player.x / this.TILE);
    const playerTileY = Math.floor(this.player.y / this.TILE);
    const entryX = this.getOffscreenLeft();

    // Move player offscreen left
    this.player.setPosition(entryX * this.TILE + this.TILE / 2, playerTileY * this.TILE + this.TILE / 2);

    // Spawn Suvi offscreen left, one tile above
    const suviY = playerTileY - 1;
    const suviDialogs = this.cache.json.get("suvi-dialogs").ncp1;
    const suvi = this.spawnNpcAt("suvi-escort", "npc1-down", entryX, suviY, suviDialogs.itIntro);

    // Build paths to walk in
    const playerPath: { x: number; y: number }[] = [];
    for (let x = entryX + 1; x <= playerTileX; x++) {
      playerPath.push({ x, y: playerTileY });
    }
    const suviDestX = playerTileX - 1;
    const suviPath: { x: number; y: number }[] = [];
    for (let x = entryX + 1; x <= suviDestX; x++) {
      suviPath.push({ x, y: suviY });
    }
    // Walk down to player's row
    suviPath.push({ x: suviDestX, y: playerTileY });

    let done = 0;
    const checkBothDone = () => {
      done++;
      if (done >= 2) {
        this.isTalking = false;
        this.openForcedDialog("suvi-intro", suviDialogs.itIntro);
      }
    };

    this.walkPlayerAlongPath(playerPath, checkBothDone);
    this.walkNpcAlongPath(suvi, suviPath, () => {
      suvi.walking = false;
      checkBothDone();
    });
  }

  protected onChoiceConfirmed(npcId: string, choice: string): boolean {
    if (npcId !== "it-npc") return false;

    const opts = this.d.firstChoice.options;

    // "¿Qué es un SSO?"
    if (choice === opts[0]) {
      const npc = this.npcs.get("it-npc");
      if (npc) npc.choice = undefined;
      this.talkQueue = [...this.d.sso, ...this.d.tools];
      this.talkIndex = 0;
      this.showLine();
      return true;
    }

    // "Ok, entendido"
    if (choice === opts[1]) {
      const npc = this.npcs.get("it-npc");
      if (npc) npc.choice = undefined;
      this.talkQueue = this.d.tools;
      this.talkIndex = 0;
      this.showLine();
      return true;
    }

    return false;
  }

  protected onDialogClosed(npcId: string): void {
    if (npcId === "it-npc" && !this.visitedIT) {
      this.visitedIT = true;
      EventBus.emit("task-completed", "meet-it");
    }

    // Suvi walks away after intro
    if (npcId === "suvi-intro") {
      const suvi = this.npcs.get("suvi-escort");
      if (suvi) {
        const exitX = this.getOffscreenLeft();
        const suviPath: { x: number; y: number }[] = [];
        for (let x = suvi.tileX - 1; x >= exitX; x--) {
          suviPath.push({ x, y: suvi.tileY });
        }
        this.walkNpcAlongPath(suvi, suviPath, () => {
          this.removeNpc(suvi);
        });
      }
    }
  }
}
