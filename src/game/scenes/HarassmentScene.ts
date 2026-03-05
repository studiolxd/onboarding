import { EventBus } from "../EventBus";
import { BaseScene } from "./BaseScene";
import { NpcData, SceneTransitionData } from "../types";

export class HarassmentScene extends BaseScene {
  private fromScene: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private d: any;
  private protocolDone = false;
  private suviRef: NpcData | null = null;

  constructor() {
    super("HarassmentScene");
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

    this.d = this.cache.json.get("harassment-dialogs");
    this.annotateAudio(this.d["hr1"], "harassment-hr1");

    const hr1 = this.spawnNpcAt("hr1", "npc1-down", 4, 18, () => this.d["hr1"].talk);
    hr1.walking = false;

    EventBus.emit("current-scene-ready", this);
    EventBus.emit("request-scorm-data");

    if (this.fromScene === "DisconnectScene") {
      this.playEntrance();
    }
  }

  private playEntrance() {
    this.startCutscene();
    const playerTileX = Math.floor(this.player.x / this.TILE);
    const playerTileY = Math.floor(this.player.y / this.TILE);
    const entryX = this.getOffscreenLeft();

    this.player.setPosition(entryX * this.TILE + this.TILE / 2, playerTileY * this.TILE + this.TILE / 2);

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
        this.openForcedDialog("hr1", msgs, audioKeys);
      }
    };

    this.walkPlayerAlongPath(playerPath, checkBothDone);
    this.walkNpcAlongPath(hr1, hr1Path, () => {
      hr1.walking = false;
      checkBothDone();
    });
  }

  protected onDialogClosed(npcId: string): void {
    if (npcId === "hr1" && !this.protocolDone) {
      this.protocolDone = true;
      EventBus.emit("task-completed", "learn-harassment");
      const badgeData = this.cache.json.get("harassment-dialogs").badges["equality"];
      EventBus.emit("badge-earned", badgeData);
      this.spawnSuviForCompany();
    }

    // Suvi company offer closed without choosing
    if (npcId === "suvi-company" && this.suviRef) {
      const suvi = this.suviRef;
      this.suviRef = null;
      const exitX = this.getOffscreenLeft();
      const path: { x: number; y: number }[] = [];
      for (let x = suvi.tileX - 1; x >= exitX; x--) {
        path.push({ x, y: suvi.tileY });
      }
      this.walkNpcAlongPath(suvi, path, () => {
        this.removeNpc(suvi);
      });
    }
  }

  protected onChoiceConfirmed(npcId: string, choice: string): boolean {
    if (npcId === "suvi-company") {
      if (choice === "Ir a conocer la empresa") {
        this.goToCompany();
        return true;
      }
      // Quedarme — dismiss Suvi
      if (this.suviRef) {
        const suvi = this.suviRef;
        this.suviRef = null;
        const exitX = this.getOffscreenLeft();
        const path: { x: number; y: number }[] = [];
        for (let x = suvi.tileX - 1; x >= exitX; x--) {
          path.push({ x, y: suvi.tileY });
        }
        this.walkNpcAlongPath(suvi, path, () => {
          this.removeNpc(suvi);
        });
      }
      return false;
    }
    return false;
  }

  private spawnSuviForCompany() {
    this.startCutscene();
    const playerTileX = Math.floor(this.player.x / this.TILE);
    const playerTileY = Math.floor(this.player.y / this.TILE);
    const entryX = this.getOffscreenLeft();

    const suviMessages = [
      "Ahora te voy a llevar a conocer los valores, misión y visión de la empresa.",
    ];

    const suvi = this.spawnNpcAt("suvi-company", "npc1-down", entryX, playerTileY, suviMessages, () => ({
      question: "¿Vamos a conocer la empresa?",
      options: ["Ir a conocer la empresa", "Quedarme aquí por ahora"],
    }));
    this.suviRef = suvi;

    const destX = playerTileX - 1;
    const path: { x: number; y: number }[] = [];
    for (let x = entryX + 1; x <= destX; x++) {
      path.push({ x, y: playerTileY });
    }

    this.walkNpcAlongPath(suvi, path, () => {
      suvi.walking = false;
      this.endCutscene();
      this.openForcedDialog("suvi-company", suviMessages);
    });
  }

  private goToCompany() {
    this.startCutscene();
    this.stopDialogAudio();

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
      this.isTalking = false;
    }

    const playerTileX = Math.floor(this.player.x / this.TILE);
    const playerTileY = Math.floor(this.player.y / this.TILE);
    const suvi = this.suviRef;
    const excludeIds = suvi ? [suvi.id] : [];
    const playerPath = this.buildExitPathRight(playerTileX, playerTileY, excludeIds);

    let done = 0;
    const checkBothDone = () => {
      done++;
      if (done >= 2) {
        const data = this.getTransitionData();
        data.fromScene = "HarassmentScene";
        EventBus.emit("scene-changed", "CompanyScene");
        this.scene.start("CompanyScene", data);
      }
    };

    this.walkPlayerAlongPath(playerPath, checkBothDone);

    if (suvi) {
      const suviPath = this.buildExitPathRight(suvi.tileX, suvi.tileY, [suvi.id]);
      this.walkNpcAlongPath(suvi, suviPath, () => {
        this.removeNpc(suvi);
        checkBothDone();
      });
    } else {
      checkBothDone();
    }
  }
}
