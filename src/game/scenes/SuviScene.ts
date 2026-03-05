import { EventBus } from "../EventBus";
import { BaseScene } from "./BaseScene";
import { SceneTransitionData } from "../types";

export class SuviScene extends BaseScene {
  private pendingGoToHR = false;
  private stayHere = false;
  private awaitingGender = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private d: any;

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

    this.d = this.cache.json.get("suvi-dialogs").ncp1;
    this.annotateAudio(this.d, "suvi");

    this.spawnNpc(objLayer, "ncp1", "npc1-down", () => {
      if (!this.visitedSuvi) {
        return this.d.firstVisit;
      }
      return this.d.returnVisit;
    }, { tileX: 12, tileY: 16 }, () => {
      if (!this.visitedSuvi) {
        return this.d.firstChoice;
      }
      return this.d.returnChoice;
    });

    EventBus.emit("current-scene-ready", this);
    EventBus.emit("request-scorm-data");
  }

  protected onNameConfirmed(_name: string): void {
    this.askGender();
  }

  protected onChoiceConfirmed(npcId: string, choice: string): boolean {
    if (npcId !== "ncp1") return false;

    const otherName = this.resolveText(this.d.firstChoice.options[1]);
    if (choice === otherName) {
      this.startTextInput();
      return true;
    }

    const keepName = this.resolveText(this.d.firstChoice.options[0]);
    if (choice === keepName) {
      this.displayName = this.learnerName || "aventurero";
      EventBus.emit("name-changed", this.displayName);
      this.askGender();
      return true;
    }

    // Gender choices
    if (this.awaitingGender) {
      this.awaitingGender = false;
      const genderOpts = this.d.gender.options as string[];
      if (choice === genderOpts[0]) this.genderPref = "masculino";
      else if (choice === genderOpts[1]) this.genderPref = "femenino";
      else if (choice === genderOpts[2]) this.genderPref = "neutro";
      EventBus.emit("gender-changed", this.genderPref);
      this.continueAfterGender();
      return true;
    }

    const returnOpts = this.d.returnChoice.options;
    if (choice === returnOpts[0]) { // "Ir a RRHH"
      this.goToHR();
      return true;
    }
    if (choice === returnOpts[1]) { // "Quedarse aquí"
      this.stayHere = true;
      return false;
    }

    return false;
  }

  protected onDialogClosed(npcId: string): void {
    if (this.stayHere) {
      this.stayHere = false;
      return;
    }
    if (npcId === "ncp1" && !this.visitedSuvi) {
      this.visitedSuvi = true;
      EventBus.emit("task-completed", "meet-director");
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
    this.showChoices(this.d.gender);
  }

  private continueAfterGender() {
    this.visitedSuvi = true;
    EventBus.emit("task-completed", "meet-director");
    this.pendingGoToHR = true;
    this.setTalkWithAudio(this.d.afterGender);
  }

  private goToHR() {
    this.startCutscene();
    this.stopDialogAudio();
    // Close dialog if still open
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

    const suvi = this.npcs.get("ncp1");
    const playerTileX = Math.floor(this.player.x / this.TILE);
    const playerTileY = Math.floor(this.player.y / this.TILE);

    const excludeIds = suvi ? [suvi.id] : [];
    const playerPath = this.buildExitPathRight(playerTileX, playerTileY, excludeIds);

    let done = 0;
    const checkBothDone = () => {
      done++;
      if (done >= 2) {
        const data = this.getTransitionData();
        data.fromScene = "SuviScene";
        EventBus.emit("scene-changed", "HRScene");
        this.scene.start("HRScene", data);
      }
    };

    // Walk player to the right
    this.walkPlayerAlongPath(playerPath, checkBothDone);

    // Walk Suvi to the right
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
