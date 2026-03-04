import { EventBus } from "../EventBus";
import { BaseScene } from "./BaseScene";
import { SceneTransitionData } from "../types";

export class ITScene extends BaseScene {
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

    const d = this.cache.json.get("it-dialogs");

    this.spawnNpc(objLayer, "it-npc", "npc1-down", () => {
      return d["it-npc"].messages;
    }, { tileX: 15, tileY: 14 });

    EventBus.emit("current-scene-ready", this);
    EventBus.emit("request-scorm-data");
  }

  protected onDialogClosed(npcId: string): void {
    if (npcId === "it-npc") {
      EventBus.emit("course-complete");
    }
  }
}
