import { EventBus } from "../EventBus";
import { BaseScene } from "./BaseScene";
import { NpcChoice, NpcData, SceneTransitionData } from "../types";

/**
 * computerPhase tracks the HR NPC2 progressive flow:
 *   0 = initial (nextcloud/frappe available)
 *   1 = nextcloud watched, waiting for computer close to spawn HR NPC2
 *   2 = HR NPC2 delivered fichaIntro, "fichar" unlocked
 *   3 = fichar watched, waiting for computer close to deliver flexibleIntro
 *   4 = flexibleIntro delivered, "ausencia" + "turno" unlocked
 *   5 = both ausencia+turno watched, waiting for computer close to deliver farewell
 *   6 = done (badge earned)
 */
export class ITScene extends BaseScene {
  private visitedIT = false;
  private fromScene: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private d: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private d2: any; // hr2 dialogs (IT scene)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private dSec: any; // security-npc dialogs

  private computerPhase = 0;
  private hrNpc2: NpcData | null = null;
  private watchedVideos = new Set<string>();
  private suviPrlNpc: NpcData | null = null;
  private dataSecutiryDone = false;

  constructor() {
    super("ITScene");
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

    this.d = this.cache.json.get("it-dialogs")["it-npc"];
    this.annotateAudio(this.d, "it");
    // Gendered firstVisit arrays need manual annotation
    if (this.d.firstVisit.m) (this.d.firstVisit.m as any)._audio = "it-firstVisit-m";
    if (this.d.firstVisit.f) (this.d.firstVisit.f as any)._audio = "it-firstVisit-f";
    if (this.d.firstVisit.n) (this.d.firstVisit.n as any)._audio = "it-firstVisit-n";

    this.d2 = this.cache.json.get("it-dialogs")["hr2"];
    this.annotateAudio(this.d2, "it-hr2");

    this.dSec = this.cache.json.get("it-dialogs")["security-npc"];
    this.annotateAudio(this.dSec, "it-security-npc");

    this.spawnNpc(objLayer, "it-npc", "npc1-down", () => {
      if (!this.visitedIT) {
        return this.resolveGendered(this.d.firstVisit);
      }
      return this.d.returnVisit;
    }, { tileX: 4, tileY: 18 }, () => {
      if (!this.visitedIT) {
        return this.d.firstChoice;
      }
      return undefined;
    });

    // Computer prop, 2 tiles right of IT NPC — interactive & blocking
    const compTileX = 6;
    const compTileY = 18;
    const computer = this.spawnNpcAt("computer", "computer", compTileX, compTileY,
      () => {
        if (!this.visitedIT) return ["No tengo las credenciales para iniciar el ordenador."];
        return [];
      },
      () => {
        if (!this.visitedIT) return undefined;
        return this.getComputerChoice();
      }
    );
    computer.walking = false;
    computer.sprite.setScale(1);
    computer.sprite.play("computer-anim");

    // Security NPC — 2 tiles right of computer
    const secNpc = this.spawnNpcAt("security-npc", "npc1-down", 8, 18,
      () => {
        if (this.computerPhase < 6) return this.dSec.notReady;
        return this.dSec.talk;
      }
    );
    secNpc.walking = false;

    // Map video IDs to task IDs
    const videoTaskMap: Record<string, string> = {
      nextcloud: "watch-nextcloud",
      frappe: "watch-frappe",
      fichar: "watch-fichar",
      ausencia: "watch-ausencia",
      turno: "watch-turno",
    };

    // Listen for video-watched events — queue task completion for when overlay closes
    const pendingTasks: string[] = [];
    const onVideoWatched = (videoId: string) => {
      this.watchedVideos.add(videoId);
      const taskId = videoTaskMap[videoId];
      if (taskId) pendingTasks.push(taskId);
      this.checkPhaseTransition();
    };
    // When a video is closed, emit pending tasks and re-open the computer app list
    const onVideoClose = () => {
      for (const taskId of pendingTasks) {
        EventBus.emit("task-completed", taskId);
      }
      pendingTasks.length = 0;
      this.reopenComputerDialog();
    };
    // Restore watched videos from saved state
    const onRestoreWatched = (ids: string[]) => {
      for (const id of ids) this.watchedVideos.add(id);
      this.derivePhaseFromWatched();
    };

    EventBus.on("video-watched", onVideoWatched);
    EventBus.on("computer-video-closed", onVideoClose);
    EventBus.on("restore-watched-videos", onRestoreWatched);

    this.events.on("shutdown", () => {
      EventBus.off("video-watched", onVideoWatched);
      EventBus.off("computer-video-closed", onVideoClose);
      EventBus.off("restore-watched-videos", onRestoreWatched);
    });

    EventBus.emit("current-scene-ready", this);
    EventBus.emit("request-scorm-data");

    if (this.fromScene === "HRScene") {
      this.playSuviEntrance();
    }
  }

  /** Derive computerPhase from already-watched videos on restore. */
  private derivePhaseFromWatched() {
    const w = this.watchedVideos;
    if (w.has("ausencia") && w.has("turno")) {
      this.computerPhase = 6; // all done
    } else if (w.has("fichar")) {
      this.computerPhase = 4; // ausencia+turno unlocked
    } else if (w.has("nextcloud") && w.has("frappe")) {
      this.computerPhase = 2; // fichar unlocked
    }
  }

  /** Return dynamic computer choice options based on phase. */
  private getComputerChoice() {
    const options: string[] = [];

    // Phase 0: nextcloud + frappe
    if (this.computerPhase < 2) {
      options.push("Abrir Nextcloud", "Abrir Frappe");
    }
    // Phase 2: fichar unlocked
    if (this.computerPhase >= 2 && this.computerPhase < 4) {
      options.push("Fichar");
      // Keep nextcloud/frappe available for rewatching
      options.push("Abrir Nextcloud", "Abrir Frappe");
    }
    // Phase 4+: ausencia + turno unlocked
    if (this.computerPhase >= 4) {
      options.push("Solicitar ausencia", "Solicitar turno");
      options.push("Fichar", "Abrir Nextcloud", "Abrir Frappe");
    }

    options.push("Apagar ordenador");
    return { question: "¿Qué aplicación quieres abrir?", options };
  }

  /** Check if a video completion triggers a phase change. */
  private checkPhaseTransition() {
    if (this.computerPhase === 0 && this.watchedVideos.has("nextcloud") && this.watchedVideos.has("frappe")) {
      this.computerPhase = 1; // waiting for computer close
    }
    if (this.computerPhase === 2 && this.watchedVideos.has("fichar")) {
      this.computerPhase = 3; // waiting for computer close
    }
    if (this.computerPhase === 4 && this.watchedVideos.has("ausencia") && this.watchedVideos.has("turno")) {
      this.computerPhase = 5; // waiting for computer close
    }
  }

  /** Handle computer shutdown — trigger NPC2 actions based on phase. Returns true if a dialog was opened. */
  private handleComputerClosed(): boolean {
    if (this.computerPhase === 1) {
      // Nextcloud+Frappe watched, spawn HR NPC2 and deliver fichaIntro (async — dialog closes first)
      this.spawnHrNpc2AndDeliver(this.d2.fichaIntro, "hr2-ficha", () => {
        this.computerPhase = 2;
        EventBus.emit("task-completed", "learn-fichar");
      });
      return false;
    } else if (this.computerPhase === 3) {
      // Fichar watched, HR NPC2 (already present) delivers flexibleIntro
      this.deliverHrNpc2Dialog(this.d2.flexibleIntro, "hr2-flexible", () => {
        this.computerPhase = 4;
        EventBus.emit("task-completed", "learn-flexible");
      });
      return true;
    } else if (this.computerPhase === 5) {
      // All videos watched, HR NPC2 delivers farewell + badge
      this.deliverHrNpc2Dialog(this.d2.farewell, "hr2-farewell", () => {
        this.computerPhase = 6;
        const badgeData = this.cache.json.get("it-dialogs").badges["internal-apps"];
        EventBus.emit("badge-earned", badgeData);
      });
      return true;
    }
    return false;
  }

  /** Re-open the computer app list after closing a video. */
  private reopenComputerDialog() {
    const computer = this.npcs.get("computer");
    if (computer) {
      this.openDialog(computer);
    }
  }

  /** Spawn HR NPC2 (or reuse), walk to player near computer, deliver dialog. */
  private spawnHrNpc2AndDeliver(messages: string[], dialogId: string, onDone: () => void) {
    this.startCutscene();

    const playerTileX = Math.floor(this.player.x / this.TILE);
    const playerTileY = Math.floor(this.player.y / this.TILE);

    // Spawn offscreen left
    const entryX = this.getOffscreenLeft();
    const npcY = playerTileY;

    // Remove existing HR NPC2 if present
    if (this.hrNpc2) {
      this.removeNpc(this.hrNpc2);
      this.hrNpc2 = null;
    }

    const hrNpc = this.spawnNpcAt("hr2", "npc1-down", entryX, npcY, messages);
    this.hrNpc2 = hrNpc;

    // Walk to one tile left of player
    const destX = playerTileX - 1;
    const path: { x: number; y: number }[] = [];
    for (let x = entryX + 1; x <= destX; x++) {
      path.push({ x, y: npcY });
    }

    this.walkNpcAlongPath(hrNpc, path, () => {
      hrNpc.walking = false;
      this.endCutscene();

      // Store onDone callback for when dialog closes
      this._hr2DialogCallback = onDone;
      this._hr2DialogId = dialogId;

      // Open forced dialog
      const audioKeys = this.audioKeysFrom(messages);
      this.openForcedDialog(dialogId, messages, audioKeys);
    });
  }

  /** Deliver dialog from HR NPC2 already present (no spawn/walk). */
  private deliverHrNpc2Dialog(messages: string[], dialogId: string, onDone: () => void) {
    this._hr2DialogCallback = onDone;
    this._hr2DialogId = dialogId;
    const audioKeys = this.audioKeysFrom(messages);
    this.openForcedDialog(dialogId, messages, audioKeys);
  }

  private _hr2DialogCallback: (() => void) | null = null;
  private _hr2DialogId: string | null = null;

  /** Walk HR NPC2 offscreen and remove. */
  private dismissHrNpc2() {
    if (!this.hrNpc2) return;
    const npc = this.hrNpc2;
    const exitX = this.getOffscreenLeft();
    const path: { x: number; y: number }[] = [];
    for (let x = npc.tileX - 1; x >= exitX; x--) {
      path.push({ x, y: npc.tileY });
    }
    this.walkNpcAlongPath(npc, path, () => {
      this.removeNpc(npc);
      if (this.hrNpc2 === npc) this.hrNpc2 = null;
    });
  }

  private playSuviEntrance() {
    this.startCutscene();
    const playerTileX = Math.floor(this.player.x / this.TILE);
    const playerTileY = Math.floor(this.player.y / this.TILE);
    const entryX = this.getOffscreenLeft();

    // Move player offscreen left
    this.player.setPosition(entryX * this.TILE + this.TILE / 2, playerTileY * this.TILE + this.TILE / 2);

    // Spawn Suvi offscreen left, one tile above
    const suviY = playerTileY - 1;
    const suviDialogs = this.cache.json.get("suvi-dialogs").ncp1;
    this.annotateAudio(suviDialogs, "suvi");
    const suvi = this.spawnNpcAt("suvi", "npc1-down", entryX, suviY, suviDialogs.itIntro);

    // Build paths to walk in
    const playerPath: { x: number; y: number }[] = [];
    for (let x = entryX + 1; x <= playerTileX; x++) {
      playerPath.push({ x, y: playerTileY });
    }
    const suviDestX = playerTileX - 1;
    const suviPath: { x: number; y: number }[] = [];
    for (let x = entryX + 1; x <= suviDestX; x++) {
      suviPath.push({ x, y: suviY });
    }
    // Walk down to player's row
    suviPath.push({ x: suviDestX, y: playerTileY });

    let done = 0;
    const checkBothDone = () => {
      done++;
      if (done >= 2) {
        this.endCutscene();
        this.isTalking = false;
        this.openForcedDialog("suvi-intro", suviDialogs.itIntro);
      }
    };

    this.walkPlayerAlongPath(playerPath, checkBothDone);
    this.walkNpcAlongPath(suvi, suviPath, () => {
      suvi.walking = false;
      checkBothDone();
    });
  }

  protected onChoiceConfirmed(npcId: string, choice: string): boolean {
    if (npcId === "computer") {
      if (choice === "Abrir Nextcloud") {
        EventBus.emit("computer-open-app", "nextcloud");
        return false;
      }
      if (choice === "Abrir Frappe") {
        EventBus.emit("computer-open-app", "frappe");
        return false;
      }
      if (choice === "Fichar") {
        EventBus.emit("computer-open-app", "fichar");
        return false;
      }
      if (choice === "Solicitar ausencia") {
        EventBus.emit("computer-open-app", "ausencia");
        return false;
      }
      if (choice === "Solicitar turno") {
        EventBus.emit("computer-open-app", "turno");
        return false;
      }
      // "Apagar ordenador" — close dialog and check phase transitions
      if (this.handleComputerClosed()) return true;
      return false;
    }

    if (npcId === "suvi-prl") {
      if (choice === "Ir a PRL") {
        this.goToPRL();
        return true;
      }
      // "Quedarme en IT por ahora" — dismiss Suvi
      if (this.suviPrlNpc) {
        const suvi = this.suviPrlNpc;
        this.suviPrlNpc = null;
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

    if (npcId !== "it-npc") return false;

    const opts = this.d.firstChoice.options;

    // "¿Qué es un SSO?"
    if (choice === opts[0]) {
      const npc = this.npcs.get("it-npc");
      if (npc) npc.choice = undefined;
      this.talkQueue = [...this.d.sso, ...this.d.tools];
      this.audioKeys = [
        ...this.audioKeysFrom(this.d.sso),
        ...this.audioKeysFrom(this.d.tools),
      ];
      this.talkIndex = 0;
      this.showLine();
      return true;
    }

    // "Ok, entendido"
    if (choice === opts[1]) {
      const npc = this.npcs.get("it-npc");
      if (npc) npc.choice = undefined;
      this.setTalkWithAudio(this.d.tools);
      return true;
    }

    return false;
  }

  protected onDialogClosed(npcId: string): void {
    if (npcId === "it-npc" && !this.visitedIT) {
      this.visitedIT = true;
      EventBus.emit("task-completed", "meet-it");
    }

    // Suvi walks away after intro
    if (npcId === "suvi-intro") {
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

    // Security NPC — award badge after completing the talk, then spawn Suvi for PRL
    if (npcId === "security-npc" && this.computerPhase >= 6 && !this.dataSecutiryDone) {
      this.dataSecutiryDone = true;
      const badgeData = this.cache.json.get("it-dialogs").badges["data-security"];
      EventBus.emit("badge-earned", badgeData);
      this.spawnSuviForPRL();
    }

    // Suvi PRL choice dialog closed without choosing "Ir a PRL"
    if (npcId === "suvi-prl" && this.suviPrlNpc) {
      const suvi = this.suviPrlNpc;
      this.suviPrlNpc = null;
      const exitX = this.getOffscreenLeft();
      const path: { x: number; y: number }[] = [];
      for (let x = suvi.tileX - 1; x >= exitX; x--) {
        path.push({ x, y: suvi.tileY });
      }
      this.walkNpcAlongPath(suvi, path, () => {
        this.removeNpc(suvi);
      });
    }

    // HR NPC2 dialog completed
    if (this._hr2DialogId && npcId === this._hr2DialogId) {
      const callback = this._hr2DialogCallback;
      this._hr2DialogCallback = null;
      this._hr2DialogId = null;

      callback?.();

      // Only dismiss after farewell (phase 6) — stays for intermediate dialogs
      if (this.computerPhase === 6) {
        this.dismissHrNpc2();
      }
    }
  }

  /** Spawn Suvi after data-security badge, walk to player, offer PRL choice. */
  private spawnSuviForPRL() {
    this.startCutscene();

    const playerTileX = Math.floor(this.player.x / this.TILE);
    const playerTileY = Math.floor(this.player.y / this.TILE);
    const entryX = this.getOffscreenLeft();

    const suviMessages = [
      "Ahora que conoces todos los aspectos de IT para trabajar, es importante trabajar seguro.",
      "Te recomiendo hacer la formación en Prevención de Riesgos Laborales.",
    ];
    const suviChoice: NpcChoice = {
      question: "¿Quieres ir a la formación de PRL?",
      options: ["Ir a PRL", "Quedarme en IT por ahora"],
    };

    const suvi = this.spawnNpcAt("suvi-prl", "npc1-down", entryX, playerTileY, suviMessages, () => suviChoice);
    this.suviPrlNpc = suvi;

    const destX = playerTileX - 1;
    const path: { x: number; y: number }[] = [];
    for (let x = entryX + 1; x <= destX; x++) {
      path.push({ x, y: playerTileY });
    }

    this.walkNpcAlongPath(suvi, path, () => {
      suvi.walking = false;
      this.endCutscene();
      this.openForcedDialog("suvi-prl", suviMessages);
    });
  }

  private goToPRL() {
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

    const excludeIds = this.suviPrlNpc ? [this.suviPrlNpc.id] : [];
    const playerPath = this.buildExitPathRight(playerTileX, playerTileY, excludeIds);

    let done = 0;
    const checkBothDone = () => {
      done++;
      if (done >= 2) {
        const data = this.getTransitionData();
        data.fromScene = "ITScene";
        EventBus.emit("scene-changed", "PRLScene");
        this.scene.start("PRLScene", data);
      }
    };

    this.walkPlayerAlongPath(playerPath, checkBothDone);

    if (this.suviPrlNpc) {
      const suvi = this.suviPrlNpc;
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
