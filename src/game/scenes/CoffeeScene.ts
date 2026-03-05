import { EventBus } from "../EventBus";
import { BaseScene } from "./BaseScene";
import { SceneTransitionData } from "../types";

export class CoffeeScene extends BaseScene {
  constructor() {
    super("CoffeeScene");
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

    const d = this.cache.json.get("coffee-dialogs");
    this.annotateAudio(d["suvi-coffee"], "coffee");

    this.spawnNpc(objLayer, "suvi-coffee", "npc1-down", () => {
      return d["suvi-coffee"].messages;
    }, { tileX: 18, tileY: 18 });

    EventBus.emit("current-scene-ready", this);
    EventBus.emit("request-scorm-data");
  }
}
