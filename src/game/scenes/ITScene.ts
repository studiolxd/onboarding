import { EventBus } from "../EventBus";
import { BaseScene } from "./BaseScene";
import { SceneTransitionData } from "../types";

export class ITScene extends BaseScene {
  private visitedIT = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private d: any;

  constructor() {
    super("ITScene");
  }

  init(data?: SceneTransitionData) {
    if (data && data.learnerName) {
      this.restoreFromTransitionData(data);
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
    }, { tileX: 15, tileY: 14 }, () => {
      if (!this.visitedIT) {
        return this.d.firstChoice;
      }
      return undefined;
    });

    EventBus.emit("current-scene-ready", this);
    EventBus.emit("request-scorm-data");
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
  }
}
