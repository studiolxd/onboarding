import { EventBus } from "../EventBus";
import { BaseScene } from "./BaseScene";
import { SceneTransitionData } from "../types";

export class DisconnectScene extends BaseScene {
  private fromScene: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private d: any;

  constructor() {
    super("DisconnectScene");
  }

  init(data?: SceneTransitionData) {
    if (data && data.learnerName) {
      this.restoreFromTransitionData(data);
      this.fromScene = data.fromScene || null;
    }
  }

  create() {
    this.createMapAndPlayer();
    this.setupCamera();
    this.setupInput();
    this.setupBaseEventListeners();

    this.d = this.cache.json.get("disconnect-dialogs");
    this.annotateAudio(this.d["hr1"], "disconnect-hr1");

    // Spawn HR1 NPC
    const hr1 = this.spawnNpcAt("hr1", "npc1-down", 4, 18, () => this.d["hr1"].talk);
    hr1.walking = false;

    EventBus.emit("current-scene-ready", this);
    EventBus.emit("request-scorm-data");

    if (this.fromScene === "PRLScene") {
      this.playEntrance();
    }
  }

  private playEntrance() {
    this.startCutscene();
    const playerTileX = Math.floor(this.player.x / this.TILE);
    const playerTileY = Math.floor(this.player.y / this.TILE);
    const entryX = this.getOffscreenLeft();

    this.player.setPosition(entryX * this.TILE + this.TILE / 2, playerTileY * this.TILE + this.TILE / 2);

    // Remove pre-placed HR1 and re-spawn from offscreen
    const existingHr1 = this.npcs.get("hr1");
    if (existingHr1) this.removeNpc(existingHr1);

    const hr1Y = playerTileY - 1;
    const hr1 = this.spawnNpcAt("hr1", "npc1-down", entryX, hr1Y, this.d["hr1"].talk);

    const playerPath: { x: number; y: number }[] = [];
    for (let x = entryX + 1; x <= playerTileX; x++) {
      playerPath.push({ x, y: playerTileY });
    }
    const hr1DestX = playerTileX - 1;
    const hr1Path: { x: number; y: number }[] = [];
    for (let x = entryX + 1; x <= hr1DestX; x++) {
      hr1Path.push({ x, y: hr1Y });
    }
    hr1Path.push({ x: hr1DestX, y: playerTileY });

    let done = 0;
    const checkBothDone = () => {
      done++;
      if (done >= 2) {
        this.endCutscene();
        this.isTalking = false;
        const msgs = this.d["hr1"].talk;
        const audioKeys = this.audioKeysFrom(msgs);
        this.openForcedDialog("hr1-intro", msgs, audioKeys);
      }
    };

    this.walkPlayerAlongPath(playerPath, checkBothDone);
    this.walkNpcAlongPath(hr1, hr1Path, () => {
      hr1.walking = false;
      checkBothDone();
    });
  }

  protected onDialogClosed(npcId: string): void {
    if (npcId === "hr1-intro" || npcId === "hr1") {
      EventBus.emit("task-completed", "learn-disconnect");
      const badgeData = this.cache.json.get("disconnect-dialogs").badges["digital-disconnect"];
      EventBus.emit("badge-earned", badgeData);
    }
  }
}
