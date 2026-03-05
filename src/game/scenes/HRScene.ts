import { EventBus } from "../EventBus";
import { BaseScene } from "./BaseScene";
import { NpcChoice, SceneTransitionData } from "../types";

export class HRScene extends BaseScene {
  // Team
  private teamSpawned = false;
  private teamDismissed = false;
  private teamNpcIds: string[] = [];
  private lastHr1Choice: string | null = null;
  private singleTeamRespawn: string | null = null;
  private respawnTimeouts = new Map<string, Phaser.Time.TimerEvent>();
  private respawnedIds: string[] = [];

  // HR3 functions
  private hr3FunctionIndex = 0;

  // Dialog data from JSON
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private d: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private teamConfig: any[] = [];
  private roleFunctions: Record<string, { name: string; brief: string; detail: string }[]> = {};

  // Scene transition
  private fromScene: string | null = null;
  private finaleTriggered = false;
  private suviFinaleNpc: import("../types").NpcData | null = null;

  constructor() {
    super("HRScene");
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

    // Load dialog data
    this.d = this.cache.json.get("hr-dialogs");
    this.teamConfig = this.d.team;
    this.teamNpcIds = this.teamConfig.map((c: { id: string }) => c.id);
    this.roleFunctions = this.d.roleFunctions;

    // Annotate dialog arrays with audio paths
    this.annotateAudio(this.d.hr1, "hr-hr1");
    // Override welcome.messages path (nested becomes flat)
    if (this.d.hr1.welcome?.messages) {
      (this.d.hr1.welcome.messages as any)._audio = "hr-hr1-welcome";
    }
    this.annotateAudio(this.d.hr2, "hr-hr2");
    // Override topic audio paths (avoid spaces in filenames)
    if (this.d.hr2.topics) {
      const topicMap: Record<string, string> = {
        "Teletrabajo": "hr-hr2-teletrabajo",
        "Trabajo flexible": "hr-hr2-flexible",
        "Trabajo por proyectos": "hr-hr2-proyectos",
      };
      for (const [key, prefix] of Object.entries(topicMap)) {
        if (this.d.hr2.topics[key]) {
          (this.d.hr2.topics[key] as any)._audio = prefix;
        }
      }
    }
    this.annotateAudio(this.d.hr3, "hr-hr3");
    this.annotateAudio(this.d.finale, "hr-finale");
    // Team members
    for (const cfg of this.teamConfig) {
      if (Array.isArray(cfg.messages)) {
        (cfg.messages as any)._audio = `hr-${cfg.id}`;
      } else {
        if (cfg.messages.m) (cfg.messages.m as any)._audio = `hr-${cfg.id}-m`;
        if (cfg.messages.f) (cfg.messages.f as any)._audio = `hr-${cfg.id}-f`;
        if (cfg.messages.n) (cfg.messages.n as any)._audio = `hr-${cfg.id}-n`;
      }
      if (cfg.extraMessages) {
        (cfg.extraMessages as any)._audio = `hr-${cfg.id}-extra`;
      }
    }

    // HR-specific restore: team state & finale
    if (this.visitedHr1) {
      this.teamSpawned = true;
      this.teamDismissed = true;
    }
    if (this.visitedHr1 && this.visitedHr2 && this.visitedHr3) {
      this.finaleTriggered = true;
    }
    EventBus.on("restore-progress", (progress: { visitedSuvi?: boolean; visitedHr1?: boolean; visitedHr2?: boolean; visitedHr3?: boolean }) => {
      if (progress.visitedHr1) {
        this.teamSpawned = true;
        this.teamDismissed = true;
      }
      if (progress.visitedHr1 && progress.visitedHr2 && progress.visitedHr3) {
        this.finaleTriggered = true;
      }
    });

    // --- NPCs ---
    this.spawnNpc(objLayer, "hr1", "npc1-down", () => {
      if (!this.visitedHr1) {
        if (this.teamSpawned && !this.teamDismissed) {
          return this.d.hr1.teamOnScreen;
        }
        return this.d.hr1.firstVisit;
      }
      return this.d.hr1.returnVisit;
    }, { tileX: 17, tileY: 20 }, () => {
      if (!this.visitedHr1) return undefined;

      const available = this.teamConfig
        .filter((c) => !this.npcs.has(c.id))
        .map((c) => c.id.charAt(0).toUpperCase() + c.id.slice(1));

      if (available.length === 0) return undefined;

      const skip = this.d.hr1.skipOption;
      const options = available.length === this.teamConfig.length
        ? [skip, this.d.hr1.allTeamOption, ...available]
        : available.length > 1
          ? [skip, this.d.hr1.someTeamOption, ...available]
          : [skip, ...available];

      return {
        question: this.d.hr1.choiceQuestion,
        options,
      };
    });

    // HR2: forma de trabajar
    this.spawnNpc(objLayer, "hr2", "npc1-down", () => {
      if (!this.visitedHr2) {
        const redirect = this.visitedHr1
          ? this.d.hr2.redirectHr3
          : this.d.hr2.redirectHr1;
        const msgs = [...this.d.hr2.firstVisit, redirect];
        const redirectKey = this.visitedHr1 ? "hr-hr2-redirectHr3-0" : "hr-hr2-redirectHr1-0";
        (msgs as any)._audioKeys = [
          ...this.audioKeysFrom(this.d.hr2.firstVisit),
          redirectKey,
        ];
        return msgs;
      }
      return this.d.hr2.returnVisit;
    }, { tileX: 20, tileY: 16 }, () => {
      if (!this.visitedHr2) return undefined;
      return this.d.hr2.choice;
    });

    // HR3: rol + funciones
    this.spawnNpc(objLayer, "hr3", "npc1-down", () => {
      if (!this.visitedHr1 || !this.visitedHr2) {
        if (!this.visitedHr1 && !this.visitedHr2) return this.d.hr3.blockedBoth;
        if (!this.visitedHr1) return this.d.hr3.blockedHr1;
        return this.d.hr3.blockedHr2;
      }
      if (!this.learnerRole) {
        return this.d.hr3.firstVisit;
      }
      return this.d.hr3.withRole;
    }, { tileX: 22, tileY: 24 }, () => {
      if (!this.visitedHr1 || !this.visitedHr2) return undefined;
      if (this.learnerRole) {
        return this.d.hr3.withRoleChoice;
      }
      return this.d.hr3.roleChoice;
    });

    EventBus.emit("current-scene-ready", this);
    EventBus.emit("request-scorm-data");

    // Entrance animation: player and Suvi walk in from the left
    if (this.fromScene === "SuviScene" && !this.visitedHr1) {
      this.playSuviEntrance();
    }
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
    const suvi = this.spawnNpcAt("suvi", "npc1-down", entryX, suviY, suviDialogs.hrIntro);

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
        this.openForcedDialog("suvi-intro", suviDialogs.hrIntro);
      }
    };

    this.walkPlayerAlongPath(playerPath, checkBothDone);
    this.walkNpcAlongPath(suvi, suviPath, () => {
      suvi.walking = false;
      checkBothDone();
    });
  }

  // ─── Hook overrides ───

  protected onChoiceConfirmed(npcId: string, choice: string): boolean {
    if (npcId === "hr1") {
      this.lastHr1Choice = choice;
      return false; // Let closeDialog handle the rest
    }

    if (npcId === "hr2") {
      if (choice === this.d.hr2.choice.options[0]) return false; // "Nada, gracias"
      const topics: Record<string, string[]> = this.d.hr2.topics;
      const topicMsgs = topics[choice] ?? [];
      if (topicMsgs.length === 0) return false;
      this.setTalkWithAudio(topicMsgs);
      return true;
    }

    // Team member choices
    if (this.teamNpcIds.includes(npcId)) {
      const opts = this.resolveGendered(this.d.teamMemberChoice.options) as string[];
      const tellMore = opts[0]; // "Cuéntame más"
      if (choice === tellMore) {
        const cfg = this.teamConfig.find((c) => c.id === npcId);
        if (!cfg) return false;
        const npc = this.npcs.get(npcId);
        if (npc) npc.choice = undefined;
        this.setTalkWithAudio(cfg.extraMessages);
        return true;
      }
      return false;
    }

    if (npcId === "hr3") {
      return this.handleHr3Choice(choice);
    }

    // Suvi finale choice
    if (npcId === "suvi-finale") {
      const finaleOpts = this.d.finale.choice.options;
      if (choice === finaleOpts[0]) { // "Vamos"
        this.goToIT();
        return true;
      }
      // "Quiero seguir charlando" → dialog closes, onDialogClosed handles Suvi leaving
      return false;
    }

    return false;
  }

  protected onDialogClosed(npcId: string): void {
    if (npcId === "hr1-welcome") {
      EventBus.emit("badge-earned", this.d.hr1.badge);
    }
    if (npcId === "hr1" && !this.teamSpawned) {
      this.spawnTeam();
    }
    if (this.teamNpcIds.includes(npcId) && !this.visitedHr1 && this.allTeamTalkedTo()) {
      this.dismissTeam();
      this.triggerHr1Welcome();
    }
    if (npcId === "hr2" && !this.visitedHr2) {
      this.visitedHr2 = true;
      EventBus.emit("task-completed", "learn-culture");
    }
    if (npcId === "hr3") {
      this.resetHr3Choice();
    }

    // HR1 re-presentación
    const skip = this.d.hr1.skipOption;
    if (npcId === "hr1" && this.visitedHr1 && this.lastHr1Choice && this.lastHr1Choice !== skip) {
      this.respawnTeamMember(this.lastHr1Choice);
      this.lastHr1Choice = null;
    }

    // Re-spawn: dismiss after talking
    if (this.respawnedIds.includes(npcId)) {
      this.cancelNpcTimeout(npcId);
      this.respawnedIds = this.respawnedIds.filter((id) => id !== npcId);
      this.dismissSingleTeamMember(npcId);
      if (npcId === this.singleTeamRespawn) {
        this.singleTeamRespawn = null;
      }
    }

    // Suvi entrance: after intro dialog, Suvi walks away
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

    // Suvi finale: dismissed after "Quiero seguir charlando"
    if (npcId === "suvi-finale" && this.suviFinaleNpc) {
      this.dismissSuviFinale();
    }

    // Finale check (Suvi arrives when all HR done)
    if (npcId !== "suvi-intro" && npcId !== "suvi-finale") {
      this.checkFinale();
    }
  }

  // ─── HR3 helpers ───

  private handleHr3Choice(choice: string): boolean {
    const hr3 = this.d.hr3;
    const funcOpts = hr3.functionChoice.options;

    if (choice === hr3.withRoleChoice.options[1]) { // "Cambiar rol"
      const allRoles = hr3.roleChoice.options as string[];
      const otherRoles = allRoles.filter((r: string) => r !== this.learnerRole);
      this.showChoices({
        question: hr3.changeRoleQuestion,
        options: otherRoles,
      });
      return true;
    }

    if (choice === hr3.withRoleChoice.options[2]) { // "Consultar funciones"
      this.hr3FunctionIndex = 0;
      this.showNextFunction();
      return true;
    }

    if (choice === funcOpts[0]) { // "Saber más"
      const funcs = this.roleFunctions[this.learnerRole] ?? [];
      const fn = funcs[this.hr3FunctionIndex];
      if (fn) {
        this.hr3FunctionIndex++;
        const roleKey = this.roleAudioKey();
        this.talkQueue = [fn.detail];
        this.audioKeys = [`hr-fn-${roleKey}-${this.hr3FunctionIndex - 1}-detail-0`];
        this.talkIndex = 0;
        this.showLine();
        this.prepareNextFunctionChoice();
      }
      return true;
    }

    if (choice === funcOpts[1]) { // "Ok, siguiente"
      this.hr3FunctionIndex++;
      this.showNextFunction();
      return true;
    }

    // Role selection
    const allRoles = hr3.roleChoice.options as string[];
    if (allRoles.includes(choice)) {
      if (this.learnerRole) {
        const oldBadgeId = `rol-${this.learnerRole.toLowerCase().replace(/ /g, "-")}`;
        EventBus.emit("badge-removed", { id: oldBadgeId });
      }

      this.learnerRole = choice;
      EventBus.emit("choice-made", { npcId: "hr3", choice });

      if (!this.visitedHr3) {
        this.hr3FunctionIndex = 0;
        const funcs = this.roleFunctions[choice] ?? [];
        if (funcs.length > 0) {
          const npc = this.npcs.get("hr3");
          if (npc) {
            npc.choice = {
              question: `${funcs[0].name}: ${funcs[0].brief}`,
              options: funcOpts,
            };
          }
        }
        this.talkQueue = [hr3.roleSelected.replace("{role}", choice)];
        this.audioKeys = ["hr-hr3-roleSelected-0"];
        this.talkIndex = 0;
        this.showLine();
      } else {
        return false;
      }
      return true;
    }

    return false;
  }

  private prepareNextFunctionChoice() {
    const npc = this.npcs.get("hr3");
    if (!npc) return;
    const funcs = this.roleFunctions[this.learnerRole] ?? [];
    if (this.hr3FunctionIndex >= funcs.length) {
      npc.choice = undefined;
    } else {
      const nextFn = funcs[this.hr3FunctionIndex];
      npc.choice = {
        question: `${nextFn.name}: ${nextFn.brief}`,
        options: this.d.hr3.functionChoice.options,
      };
    }
  }

  private showNextFunction() {
    const funcs = this.roleFunctions[this.learnerRole] ?? [];
    if (this.hr3FunctionIndex >= funcs.length) {
      if (!this.visitedHr3) {
        this.visitedHr3 = true;
        EventBus.emit("task-completed", "learn-role");
      }
      const npc = this.npcs.get("hr3");
      if (npc) npc.choice = undefined;
      EventBus.emit("badge-earned", {
        id: `rol-${this.learnerRole.toLowerCase().replace(/ /g, "-")}`,
        name: this.learnerRole,
        description: `Tu rol: ${this.learnerRole}`,
      });
      this.talkQueue = [this.d.hr3.allFunctionsDone];
      this.audioKeys = ["hr-hr3-allFunctionsDone-0"];
      this.talkIndex = 0;
      this.showLine();
      return;
    }
    const fn = funcs[this.hr3FunctionIndex];
    const roleKey = this.roleAudioKey();
    this.talkQueue = [`${fn.name}: ${fn.brief}`];
    this.audioKeys = [`hr-fn-${roleKey}-${this.hr3FunctionIndex}-brief-0`];
    this.talkIndex = 0;
    this.showLine();
    const npc = this.npcs.get("hr3");
    if (npc) {
      npc.choice = {
        question: `${fn.name}: ${fn.brief}`,
        options: this.d.hr3.functionChoice.options,
      };
    }
  }

  private resetHr3Choice() {
    const npc = this.npcs.get("hr3");
    if (npc) {
      npc.choice = () => {
        if (!this.visitedHr1 || !this.visitedHr2) return undefined;
        if (this.learnerRole) {
          return this.d.hr3.withRoleChoice;
        }
        return this.d.hr3.roleChoice;
      };
    }
  }

  /** Map current role to a short key for audio file naming. */
  private roleAudioKey(): string {
    if (this.learnerRole === "Diseñador instruccional") return "di";
    if (this.learnerRole === "Diseñador gráfico") return "dg";
    return "prog";
  }

  // ─── Team management ───

  private allTeamTalkedTo(): boolean {
    return this.teamNpcIds.every((id) => this.talkedTo.has(id));
  }

  private teamMemberChoice(): NpcChoice {
    const raw = this.d.teamMemberChoice;
    return {
      question: raw.question,
      options: this.resolveGendered(raw.options) as string[],
    };
  }

  private spawnTeam() {
    if (this.teamSpawned) return;
    this.teamSpawned = true;

    const hr1Npc = this.npcs.get("hr1");
    const baseX = hr1Npc ? hr1Npc.tileX : 12;
    const baseY = hr1Npc ? hr1Npc.tileY : 16;

    const cam = this.cameras.main;
    const visibleRight = cam.midPoint.x + this.scale.width / (2 * this.ZOOM);
    const spawnX = Math.min(
      Math.ceil(visibleRight / this.TILE) + 2,
      this.map.width - 1
    );

    this.teamConfig.forEach((cfg, i) => {
      const destX = baseX + cfg.offsetX;
      const destY = baseY + cfg.offsetY;
      const spawnY = baseY - 1 + i;

      const npc = this.spawnNpcAt(cfg.id, "player-down", spawnX, spawnY, this.resolveGendered(cfg.messages), this.teamMemberChoice());

      this.time.delayedCall(i * 300, () => {
        const path = this.findPathForNpc(spawnX, spawnY, destX, destY, npc);
        if (path.length > 0) {
          this.walkNpcAlongPath(npc, path, () => {
            npc.walking = false;
            npc.sprite.setTexture("player-down", 0);
            npc.sprite.setFlipX(false);
          });
        } else {
          this.teleportNpc(npc, destX, destY);
          npc.walking = false;
          npc.sprite.setTexture("player-down", 0);
          npc.sprite.setFlipX(false);
        }
      });
    });
  }

  private spawnTeamFiltered(ids: string[]) {
    const hr1Npc = this.npcs.get("hr1");
    const baseX = hr1Npc ? hr1Npc.tileX : 12;
    const baseY = hr1Npc ? hr1Npc.tileY : 16;

    const cam = this.cameras.main;
    const visibleRight = cam.midPoint.x + this.scale.width / (2 * this.ZOOM);
    const spawnX = Math.min(
      Math.ceil(visibleRight / this.TILE) + 2,
      this.map.width - 1
    );

    const configs = this.teamConfig.filter((c) => ids.includes(c.id));
    configs.forEach((cfg, i) => {
      const destX = baseX + cfg.offsetX;
      const destY = baseY + cfg.offsetY;
      const spawnY = baseY - 1 + i;

      const npc = this.spawnNpcAt(cfg.id, "player-down", spawnX, spawnY, this.resolveGendered(cfg.messages), this.teamMemberChoice());

      this.time.delayedCall(i * 300, () => {
        const path = this.findPathForNpc(spawnX, spawnY, destX, destY, npc);
        if (path.length > 0) {
          this.walkNpcAlongPath(npc, path, () => {
            npc.walking = false;
            npc.sprite.setTexture("player-down", 0);
            npc.sprite.setFlipX(false);
          });
        } else {
          this.teleportNpc(npc, destX, destY);
          npc.walking = false;
          npc.sprite.setTexture("player-down", 0);
          npc.sprite.setFlipX(false);
        }
      });
    });
  }

  private dismissTeam() {
    if (this.teamDismissed) return;
    this.teamDismissed = true;

    const cam = this.cameras.main;
    const visibleRight = cam.midPoint.x + this.scale.width / (2 * this.ZOOM);
    const exitX = Math.min(
      Math.ceil(visibleRight / this.TILE) + 2,
      this.map.width - 1
    );

    this.teamNpcIds.forEach((id, i) => {
      const npc = this.npcs.get(id);
      if (!npc) return;

      npc.walking = true;

      this.time.delayedCall(i * 300, () => {
        const exitY = npc.tileY;
        const path = this.findPathForNpc(npc.tileX, npc.tileY, exitX, exitY, npc);
        if (path.length > 0) {
          this.walkNpcAlongPath(npc, path, () => {
            this.removeNpc(npc);
          });
        } else {
          this.removeNpc(npc);
        }
      });
    });
  }

  private respawnTeamMember(choice: string) {
    this.teamDismissed = false;

    const allTeam = this.d.hr1.allTeamOption;
    const someTeam = this.d.hr1.someTeamOption;

    if (choice === allTeam || choice === someTeam) {
      const toSpawn = this.teamNpcIds.filter((id) => !this.npcs.has(id));
      const alreadyPresent = this.teamNpcIds.filter((id) => this.npcs.has(id));
      if (toSpawn.length === 0 && alreadyPresent.length === 0) return;

      this.teamSpawned = false;
      this.singleTeamRespawn = null;

      const allIds = [...toSpawn, ...alreadyPresent];
      allIds.forEach((id) => {
        if (!this.respawnedIds.includes(id)) this.respawnedIds.push(id);
      });

      if (toSpawn.length > 0) {
        this.spawnTeamFiltered(toSpawn);
      }

      allIds.forEach((id) => this.startNpcTimeout(id));
    } else {
      const name = choice.toLowerCase();
      if (this.npcs.has(name)) return;
      this.singleTeamRespawn = name;
      if (!this.respawnedIds.includes(name)) this.respawnedIds.push(name);
      this.spawnSingleTeamMember(name);
      this.startNpcTimeout(name);
    }
  }

  private startNpcTimeout(id: string) {
    const existing = this.respawnTimeouts.get(id);
    if (existing) existing.destroy();

    const timer = this.time.delayedCall(10000, () => {
      this.respawnTimeouts.delete(id);
      this.respawnedIds = this.respawnedIds.filter((rid) => rid !== id);
      if (id === this.singleTeamRespawn) this.singleTeamRespawn = null;
      this.dismissSingleTeamMember(id);
    });
    this.respawnTimeouts.set(id, timer);
  }

  private cancelNpcTimeout(id: string) {
    const timer = this.respawnTimeouts.get(id);
    if (timer) {
      timer.destroy();
      this.respawnTimeouts.delete(id);
    }
  }

  private spawnSingleTeamMember(name: string) {
    const cfg = this.teamConfig.find((c) => c.id === name);
    if (!cfg) return;

    const hr1Npc = this.npcs.get("hr1");
    const baseX = hr1Npc ? hr1Npc.tileX : 12;
    const baseY = hr1Npc ? hr1Npc.tileY : 16;

    const destX = baseX + cfg.offsetX;
    const destY = baseY + cfg.offsetY;

    const cam = this.cameras.main;
    const visibleRight = cam.midPoint.x + this.scale.width / (2 * this.ZOOM);
    const spawnX = Math.min(
      Math.ceil(visibleRight / this.TILE) + 2,
      this.map.width - 1
    );
    const spawnY = baseY;

    const npc = this.spawnNpcAt(cfg.id, "player-down", spawnX, spawnY, cfg.messages, this.teamMemberChoice());

    const path = this.findPathForNpc(spawnX, spawnY, destX, destY, npc);
    if (path.length > 0) {
      this.walkNpcAlongPath(npc, path, () => {
        npc.walking = false;
        npc.sprite.setTexture("player-down", 0);
        npc.sprite.setFlipX(false);
      });
    } else {
      this.teleportNpc(npc, destX, destY);
      npc.walking = false;
      npc.sprite.setTexture("player-down", 0);
      npc.sprite.setFlipX(false);
    }
  }

  private dismissSingleTeamMember(npcId: string) {
    const npc = this.npcs.get(npcId);
    if (!npc) return;

    npc.walking = true;

    const cam = this.cameras.main;
    const visibleRight = cam.midPoint.x + this.scale.width / (2 * this.ZOOM);
    const exitX = Math.min(
      Math.ceil(visibleRight / this.TILE) + 2,
      this.map.width - 1
    );
    const exitY = npc.tileY;

    const path = this.findPathForNpc(npc.tileX, npc.tileY, exitX, exitY, npc);
    if (path.length > 0) {
      this.walkNpcAlongPath(npc, path, () => {
        this.removeNpc(npc);
      });
    } else {
      this.removeNpc(npc);
    }
  }

  // ─── HR1 welcome ───

  private triggerHr1Welcome() {
    if (this.visitedHr1) return;
    this.visitedHr1 = true;
    EventBus.emit("task-completed", "meet-team");
    this.startCutscene();

    this.time.delayedCall(1500, () => {
      this.endCutscene();
      const welcome = this.d.hr1.welcome;
      const redirect = !this.visitedHr2
        ? welcome.redirectHr2
        : welcome.redirectHr3;
      const redirectKey = !this.visitedHr2 ? "hr-hr1-redirectHr2-0" : "hr-hr1-redirectHr3-0";
      this.openForcedDialog("hr1-welcome", [
        ...welcome.messages,
        redirect,
      ], [
        ...this.audioKeysFrom(welcome.messages),
        redirectKey,
      ]);
    });
  }

  // ─── Finale ───

  private checkFinale() {
    if (this.finaleTriggered) return;
    if (!this.visitedHr1 || !this.visitedHr2 || !this.visitedHr3) return;
    this.finaleTriggered = true;
    this.startCutscene();

    // Spawn Suvi offscreen left and walk her to the player
    this.time.delayedCall(500, () => {
      const entryX = this.getOffscreenLeft();
      const playerTileX = Math.floor(this.player.x / this.TILE);
      const playerTileY = Math.floor(this.player.y / this.TILE);
      const destX = playerTileX - 1;
      const destY = playerTileY;

      const suviDialogs = this.cache.json.get("suvi-dialogs").ncp1;
      const suvi = this.spawnNpcAt("suvi", "npc1-down", entryX, destY, suviDialogs.hrIntro);
      this.suviFinaleNpc = suvi;

      const suviPath: { x: number; y: number }[] = [];
      for (let x = entryX + 1; x <= destX; x++) {
        suviPath.push({ x, y: destY });
      }

      this.walkNpcAlongPath(suvi, suviPath, () => {
        suvi.walking = false;
        suvi.choice = this.d.finale.choice;
        this.endCutscene();
        this.openForcedDialog("suvi-finale", this.resolveMessages(this.d.finale.greeting), this.audioKeysFrom(this.d.finale.greeting));
      });
    });
  }

  private goToIT() {
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

    const playerTileX = Math.floor(this.player.x / this.TILE);
    const playerTileY = Math.floor(this.player.y / this.TILE);

    const excludeIds = this.suviFinaleNpc ? [this.suviFinaleNpc.id] : [];
    const playerPath = this.buildExitPathRight(playerTileX, playerTileY, excludeIds);

    let done = 0;
    const checkBothDone = () => {
      done++;
      if (done >= 2) {
        const data = this.getTransitionData();
        data.fromScene = "HRScene";
        EventBus.emit("scene-changed", "ITScene");
        this.scene.start("ITScene", data);
      }
    };

    this.walkPlayerAlongPath(playerPath, checkBothDone);

    if (this.suviFinaleNpc) {
      const suvi = this.suviFinaleNpc;
      const suviPath = this.buildExitPathRight(suvi.tileX, suvi.tileY, [suvi.id]);
      this.walkNpcAlongPath(suvi, suviPath, () => {
        this.removeNpc(suvi);
        checkBothDone();
      });
    } else {
      checkBothDone();
    }
  }

  private dismissSuviFinale() {
    if (!this.suviFinaleNpc) return;
    const suvi = this.suviFinaleNpc;
    this.suviFinaleNpc = null;

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
