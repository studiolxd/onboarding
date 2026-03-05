import { EventBus } from "../EventBus";
import { BaseScene } from "./BaseScene";
import { NpcData, SceneTransitionData } from "../types";

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
  private badgeAwarded = false;
  private hr1Npc: NpcData | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private dHr1: any;

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
    this.dHr1 = prlData["hr1"];
    this.annotateAudio(this.dHr1, "prl-hr1");

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
      if (this.completedRisks.size >= this.RISK_IDS.length && !this.badgeAwarded) {
        this.badgeAwarded = true;
        const badgeData = this.cache.json.get("prl-dialogs").badges["safe-work"];
        EventBus.emit("badge-earned", badgeData);
        // Don't return false yet — onDialogClosed will trigger the HR3→HR1 sequence
      }
      return false;
    }

    // HR1 disconnect choice
    if (npcId === "hr1-disconnect") {
      const opts = this.dHr1.disconnectChoice.options;
      if (choice === opts[0]) { // "Ir a desconexión digital"
        this.goToDisconnect();
        return true;
      }
      // "Quedarme aquí por ahora" — dismiss HR1
      if (this.hr1Npc) {
        const hr1 = this.hr1Npc;
        this.hr1Npc = null;
        const exitX = this.getOffscreenLeft();
        const path: { x: number; y: number }[] = [];
        for (let x = hr1.tileX - 1; x >= exitX; x--) {
          path.push({ x, y: hr1.tileY });
        }
        this.walkNpcAlongPath(hr1, path, () => {
          this.removeNpc(hr1);
        });
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

    // After levantarse with badge → trigger HR3 farewell sequence
    if (npcId === "desk" && this.badgeAwarded && !this.hr1Npc) {
      this.startHr3FarewellSequence();
    }
    if (npcId === "desk2" && this.badgeAwarded && !this.hr1Npc) {
      this.startHr3FarewellSequence();
    }

    // HR3 farewell done → HR1 arrives
    if (npcId === "hr3-farewell") {
      this.dismissHr3AndSpawnHr1();
    }

    // HR1 medical review done → show disconnect offer with choice
    if (npcId === "hr1-medical") {
      const msgs = this.dHr1.disconnectOffer;
      const audioKeys = this.audioKeysFrom(msgs);
      this.openForcedDialog("hr1-disconnect", msgs, audioKeys);
    }

    // HR1 disconnect dialog closed without choosing (shouldn't happen normally, but handle it)
    if (npcId === "hr1-disconnect" && this.hr1Npc) {
      const hr1 = this.hr1Npc;
      this.hr1Npc = null;
      const exitX = this.getOffscreenLeft();
      const path: { x: number; y: number }[] = [];
      for (let x = hr1.tileX - 1; x >= exitX; x--) {
        path.push({ x, y: hr1.tileY });
      }
      this.walkNpcAlongPath(hr1, path, () => {
        this.removeNpc(hr1);
      });
    }
  }

  /** HR3 says farewell. */
  private startHr3FarewellSequence() {
    const prlData = this.cache.json.get("prl-dialogs");
    const msgs = prlData["hr3-farewell"];
    this.openForcedDialog("hr3-farewell", msgs);
  }

  /** HR3 walks away, HR1 walks in and delivers medical review dialog. */
  private dismissHr3AndSpawnHr1() {
    this.startCutscene();

    const hr3 = this.npcs.get("hr3");
    const exitX = this.getOffscreenLeft();

    // HR3 walks offscreen
    const hr3Done = () => {
      // Now spawn HR1 from left
      this.spawnHr1();
    };

    if (hr3) {
      const path: { x: number; y: number }[] = [];
      for (let x = hr3.tileX - 1; x >= exitX; x--) {
        path.push({ x, y: hr3.tileY });
      }
      this.walkNpcAlongPath(hr3, path, () => {
        this.removeNpc(hr3);
        hr3Done();
      });
    } else {
      hr3Done();
    }
  }

  /** Spawn HR1 from offscreen, walk to player, deliver medical review dialog. */
  private spawnHr1() {
    const playerTileX = Math.floor(this.player.x / this.TILE);
    const playerTileY = Math.floor(this.player.y / this.TILE);
    const entryX = this.getOffscreenLeft();

    const hr1 = this.spawnNpcAt("hr1-prl", "npc1-down", entryX, playerTileY, this.dHr1.medicalReview);
    this.hr1Npc = hr1;

    const destX = playerTileX - 1;
    const path: { x: number; y: number }[] = [];
    for (let x = entryX + 1; x <= destX; x++) {
      path.push({ x, y: playerTileY });
    }

    this.walkNpcAlongPath(hr1, path, () => {
      hr1.walking = false;
      this.endCutscene();
      const audioKeys = this.audioKeysFrom(this.dHr1.medicalReview);
      this.openForcedDialog("hr1-medical", this.dHr1.medicalReview, audioKeys);
    });
  }

  private goToDisconnect() {
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

    const excludeIds = this.hr1Npc ? [this.hr1Npc.id] : [];
    const playerPath = this.buildExitPathRight(playerTileX, playerTileY, excludeIds);

    let done = 0;
    const checkBothDone = () => {
      done++;
      if (done >= 2) {
        const data = this.getTransitionData();
        data.fromScene = "PRLScene";
        EventBus.emit("scene-changed", "DisconnectScene");
        this.scene.start("DisconnectScene", data);
      }
    };

    this.walkPlayerAlongPath(playerPath, checkBothDone);

    if (this.hr1Npc) {
      const hr1 = this.hr1Npc;
      const hr1Path = this.buildExitPathRight(hr1.tileX, hr1.tileY, [hr1.id]);
      this.walkNpcAlongPath(hr1, hr1Path, () => {
        this.removeNpc(hr1);
        checkBothDone();
      });
    } else {
      checkBothDone();
    }
  }
}
