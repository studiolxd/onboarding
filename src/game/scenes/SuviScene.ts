import { EventBus } from "../EventBus";
import { BaseScene } from "./BaseScene";
import { SceneTransitionData } from "../types";

export class SuviScene extends BaseScene {
  private pendingGoToHR = false;
  private awaitingGender = false;

  constructor() {
    super("SuviScene");
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

    // Spawn Suvi
    this.spawnNpc(objLayer, "suvi-npc", "npc1-down", () => {
      if (!this.visitedSuvi) {
        return [
          "¡Hola! Soy Suvi, el director de Studio LXD.",
          "Bienvenido/a.",
        ];
      }
      return [`${this.getGreeting()}`, "¿A dónde quieres ir?"];
    }, undefined, () => {
      if (!this.visitedSuvi) {
        const scormName = this.learnerName || "aventurero";
        return {
          question: `¿Te llamo ${scormName} o prefieres otro nombre?`,
          options: [`Llámame ${scormName}`, "Prefiero otro nombre"],
        };
      }
      return {
        question: "¿Qué quieres hacer?",
        options: ["Ir a RRHH", "Quedarse aquí"],
      };
    });

    EventBus.emit("current-scene-ready", this);
    EventBus.emit("request-scorm-data");
  }

  protected onNameConfirmed(_name: string): void {
    this.askGender();
  }

  protected onChoiceConfirmed(npcId: string, choice: string): boolean {
    if (npcId !== "suvi-npc") return false;

    if (choice === "Prefiero otro nombre") {
      this.startTextInput();
      return true;
    }

    if (choice.startsWith("Llámame ")) {
      this.displayName = this.learnerName || "aventurero";
      EventBus.emit("name-changed", this.displayName);
      this.askGender();
      return true;
    }

    // Gender choices
    if (this.awaitingGender) {
      this.awaitingGender = false;
      if (choice === "Masculino") this.genderPref = "masculino";
      else if (choice === "Femenino") this.genderPref = "femenino";
      else if (choice === "Neutro") this.genderPref = "neutro";
      EventBus.emit("gender-changed", this.genderPref);
      this.continueAfterGender();
      return true;
    }

    if (choice === "Ir a RRHH") {
      this.goToHR();
      return true;
    }

    return false; // "Quedarse aquí" or others → close dialog
  }

  protected onDialogClosed(npcId: string): void {
    if (npcId === "suvi-npc" && !this.visitedSuvi) {
      this.visitedSuvi = true;
      EventBus.emit("progress-updated", { visitedSuvi: true });
      this.goToHR();
      return;
    }
    if (this.pendingGoToHR) {
      this.pendingGoToHR = false;
      this.goToHR();
    }
  }

  private askGender() {
    this.awaitingGender = true;
    this.showChoices({
      question: "¿Cómo prefieres que nos dirijamos a ti?",
      options: ["Masculino", "Femenino", "Neutro"],
    });
  }

  private continueAfterGender() {
    this.visitedSuvi = true;
    EventBus.emit("progress-updated", { visitedSuvi: true });
    this.pendingGoToHR = true;
    this.talkQueue = [
      `${this.getGreeting()}`,
      "Te llevo con el equipo de RRHH.",
      "Ellos te presentarán al equipo y te explicarán cómo trabajamos.",
    ];
    this.talkIndex = 0;
    this.showLine();
  }

  private goToHR() {
    const data = this.getTransitionData();
    data.fromScene = "SuviScene";
    EventBus.emit("scene-changed", "HRScene");
    this.scene.start("HRScene", data);
  }
}
