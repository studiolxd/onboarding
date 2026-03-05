import { EventBus } from "../EventBus";
import { BaseScene } from "./BaseScene";
import { SceneTransitionData } from "../types";

export class PRLScene extends BaseScene {
  private talkedToHr3 = false;
  private fromScene: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private d: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private dDesk: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private dRisks: any;

  private completedRisks = new Set<string>();
  private readonly RISK_IDS = ["ergonomicos", "visuales", "psicosociales", "electricos", "pantallas"];

  constructor() {
    super("PRLScene");
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

    const prlData = this.cache.json.get("prl-dialogs");
    this.d = prlData["hr3"];
    this.annotateAudio(this.d, "prl-hr3");
    this.dDesk = prlData["desk"];
    this.dRisks = prlData["risks"];

    // HR3 NPC
    this.spawnNpc(objLayer, "hr3", "npc1-down", () => {
      if (!this.talkedToHr3) return this.d.intro;
      return this.d.notReady;
    }, { tileX: 4, tileY: 18 });

    // Desk — 2 tiles wide (tileX 6-7, tileY 17), not walkable
    const desk1 = this.spawnNpcAt("desk", "computer", 6, 17,
      () => {
        if (!this.talkedToHr3) return this.dDesk.notReady;
        return [];
      },
      () => {
        if (!this.talkedToHr3) return undefined;
        return this.getDeskChoice();
      }
    );
    desk1.walking = false;
    desk1.sprite.setScale(1);
    desk1.sprite.play("computer-anim");

    // Second tile of desk
    const desk2 = this.spawnNpcAt("desk2", "computer", 7, 17,
      () => {
        if (!this.talkedToHr3) return this.dDesk.notReady;
        return [];
      },
      () => {
        if (!this.talkedToHr3) return undefined;
        return this.getDeskChoice();
      }
    );
    desk2.walking = false;
    desk2.sprite.setScale(1);
    desk2.sprite.play("computer-anim");

    // Chair — 2 tiles wide (tileX 6-7, tileY 18), player CAN walk on these
    // We spawn them as non-blocking visual elements
    const chair1 = this.add.sprite(
      6 * this.TILE + this.TILE / 2,
      18 * this.TILE + this.TILE / 2,
      "computer", 0
    );
    chair1.setScale(1);
    chair1.setDepth(5);

    const chair2 = this.add.sprite(
      7 * this.TILE + this.TILE / 2,
      18 * this.TILE + this.TILE / 2,
      "computer", 0
    );
    chair2.setScale(1);
    chair2.setDepth(5);

    // Listen for info panel closed
    const onInfoClosed = (riskId: string) => {
      if (!this.completedRisks.has(riskId)) {
        this.completedRisks.add(riskId);
        const taskMap: Record<string, string> = {
          ergonomicos: "risk-ergonomicos",
          visuales: "risk-visuales",
          psicosociales: "risk-psicosociales",
          electricos: "risk-electricos",
          pantallas: "risk-pantallas",
        };
        const taskId = taskMap[riskId];
        if (taskId) EventBus.emit("task-completed", taskId);
      }
      // Reopen desk menu
      this.reopenDeskDialog();
    };

    // Restore completed risks from saved state
    const onRestoreRisks = (ids: string[]) => {
      for (const id of ids) this.completedRisks.add(id);
    };

    EventBus.on("prl-info-closed", onInfoClosed);
    EventBus.on("restore-completed-risks", onRestoreRisks);

    this.events.on("shutdown", () => {
      EventBus.off("prl-info-closed", onInfoClosed);
      EventBus.off("restore-completed-risks", onRestoreRisks);
    });

    EventBus.emit("current-scene-ready", this);
    EventBus.emit("request-scorm-data");

    if (this.fromScene === "ITScene") {
      this.playSuviEntrance();
    }
  }

  private getDeskChoice() {
    const options: string[] = [];
    for (const id of this.RISK_IDS) {
      const label = this.dRisks[id].title;
      if (this.completedRisks.has(id)) {
        options.push(label + " (completado)");
      } else {
        options.push(label);
      }
    }
    options.push("Levantarse");
    return { question: "Selecciona un tema para estudiar:", options };
  }

  private reopenDeskDialog() {
    const desk = this.npcs.get("desk");
    if (desk) {
      this.openDialog(desk);
    }
  }

  private playSuviEntrance() {
    this.startCutscene();
    const playerTileX = Math.floor(this.player.x / this.TILE);
    const playerTileY = Math.floor(this.player.y / this.TILE);
    const entryX = this.getOffscreenLeft();

    this.player.setPosition(entryX * this.TILE + this.TILE / 2, playerTileY * this.TILE + this.TILE / 2);

    const suviY = playerTileY - 1;
    const suviDialogs = this.cache.json.get("suvi-dialogs").ncp1;
    this.annotateAudio(suviDialogs, "suvi");
    const suvi = this.spawnNpcAt("suvi", "npc1-down", entryX, suviY, suviDialogs.prlIntro || ["Para trabajar seguro es importante que hagas la formación en PRL."]);

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
        this.openForcedDialog("suvi-prl-intro", suvi.messages as string[]);
      }
    };

    this.walkPlayerAlongPath(playerPath, checkBothDone);
    this.walkNpcAlongPath(suvi, suviPath, () => {
      suvi.walking = false;
      checkBothDone();
    });
  }

  protected onChoiceConfirmed(npcId: string, choice: string): boolean {
    if (npcId === "desk" || npcId === "desk2") {
      // Map choice text to risk ID
      for (const id of this.RISK_IDS) {
        const title = this.dRisks[id].title;
        if (choice === title || choice === title + " (completado)") {
          EventBus.emit("prl-open-info", {
            id,
            title: this.dRisks[id].title,
            content: this.dRisks[id].content,
          });
          return false;
        }
      }
      // "Levantarse" — close dialog and check if badge earned
      if (this.completedRisks.size >= this.RISK_IDS.length) {
        const badgeData = this.cache.json.get("prl-dialogs").badges["safe-work"];
        EventBus.emit("badge-earned", badgeData);
      }
      return false;
    }

    return false;
  }

  protected onDialogClosed(npcId: string): void {
    if (npcId === "hr3" && !this.talkedToHr3) {
      this.talkedToHr3 = true;
      EventBus.emit("task-completed", "intro-prl");
    }

    // Suvi walks away after PRL intro
    if (npcId === "suvi-prl-intro") {
      const suvi = this.npcs.get("suvi");
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
