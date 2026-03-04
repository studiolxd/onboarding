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

    // Suvi hangs out here
    this.spawnNpc(objLayer, "suvi-coffee", "npc1-down", () => {
      return [
        `${this.getGreeting()}`,
        "Estoy aquí descansando un poco.",
        "¿Quieres un café?",
      ];
    }, { tileX: 18, tileY: 18 });

    EventBus.emit("current-scene-ready", this);
    EventBus.emit("request-scorm-data");
  }
}
