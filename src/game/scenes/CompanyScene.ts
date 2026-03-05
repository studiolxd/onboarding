import { EventBus } from "../EventBus";
import { BaseScene } from "./BaseScene";
import { NpcData, SceneTransitionData } from "../types";

export class CompanyScene extends BaseScene {
  private fromScene: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private d: any;
  private cultureDone = false;
  private suviRef: NpcData | null = null;

  constructor() {
    super("CompanyScene");
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

    this.d = this.cache.json.get("company-dialogs");
    this.annotateAudio(this.d["suvi"], "company-suvi");

    const suvi = this.spawnNpcAt("suvi", "npc1-down", 4, 18, () => this.d["suvi"].talk);
    suvi.walking = false;
    this.suviRef = suvi;

    EventBus.emit("current-scene-ready", this);
    EventBus.emit("request-scorm-data");

    if (this.fromScene === "HarassmentScene") {
      this.playEntrance();
    }
  }

  private playEntrance() {
    this.startCutscene();
    const playerTileX = Math.floor(this.player.x / this.TILE);
    const playerTileY = Math.floor(this.player.y / this.TILE);
    const entryX = this.getOffscreenLeft();

    this.player.setPosition(entryX * this.TILE + this.TILE / 2, playerTileY * this.TILE + this.TILE / 2);

    const existingSuvi = this.npcs.get("suvi");
    if (existingSuvi) this.removeNpc(existingSuvi);

    const suviY = playerTileY - 1;
    const suvi = this.spawnNpcAt("suvi", "npc1-down", entryX, suviY, this.d["suvi"].talk);
    this.suviRef = suvi;

    const playerPath: { x: number; y: number }[] = [];
    for (let x = entryX + 1; x <= playerTileX; x++) {
      playerPath.push({ x, y: playerTileY });
    }
    const suviDestX = playerTileX - 1;
    const suviPath: { x: number; y: number }[] = [];
    for (let x = entryX + 1; x <= suviDestX; x++) {
      suviPath.push({ x, y: suviY });
    }
    suviPath.push({ x: suviDestX, y: playerTileY });

    let done = 0;
    const checkBothDone = () => {
      done++;
      if (done >= 2) {
        this.endCutscene();
        this.isTalking = false;
        const msgs = this.d["suvi"].talk;
        const audioKeys = this.audioKeysFrom(msgs);
        this.openForcedDialog("suvi", msgs, audioKeys);
      }
    };

    this.walkPlayerAlongPath(playerPath, checkBothDone);
    this.walkNpcAlongPath(suvi, suviPath, () => {
      suvi.walking = false;
      checkBothDone();
    });
  }

  protected onDialogClosed(npcId: string): void {
    if (npcId === "suvi" && !this.cultureDone) {
      this.cultureDone = true;
      EventBus.emit("task-completed", "learn-company");
      const badgeData = this.cache.json.get("company-dialogs").badges["company-culture"];
      EventBus.emit("badge-earned", badgeData);
      // Suvi offers to go to branding
      const suvi = this.suviRef;
      if (suvi) {
        suvi.choice = () => ({
          question: "¿Vamos a conocer al equipo de diseño y comunicación?",
          options: ["Ir a Branding", "Quedarme aquí por ahora"],
        });
      }
      this.openForcedDialog("suvi", [
        "Además de la cultura de la empresa, cuidar el diseño y la comunicación es muy importante.",
        "Te llevo a conocer al equipo de diseño y comunicación.",
      ]);
    }
  }

  protected onChoiceConfirmed(npcId: string, choice: string): boolean {
    if (npcId === "suvi") {
      if (choice === "Ir a Branding") {
        this.goToBranding();
        return true;
      }
      // Quedarme — dismiss Suvi
      const suvi = this.suviRef;
      if (suvi) {
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

  private goToBranding() {
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
        data.fromScene = "CompanyScene";
        EventBus.emit("scene-changed", "BrandingScene");
        this.scene.start("BrandingScene", data);
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
