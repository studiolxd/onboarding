import { EventBus } from "../EventBus";
import { BaseScene } from "./BaseScene";
import { NpcData, SceneTransitionData } from "../types";

export class OfficeScene extends BaseScene {
  private fromScene: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private d: any;
  private talkedRoleNpcs = new Set<string>();
  private badgeAwarded = false;

  constructor() {
    super("OfficeScene");
  }

  init(data?: SceneTransitionData) {
    if (data && data.learnerName) {
      this.restoreFromTransitionData(data);
      this.fromScene = data.fromScene || null;
    }
  }

  create() {
    this.createMapAndPlayer();
    this.setupCamera();
    this.setupInput();
    this.setupBaseEventListeners();

    this.d = this.cache.json.get("office-dialogs");

    const role = this.learnerRole || "Diseñador instruccional";
    const roleNpcIds: string[] = this.d.roleNpcs[role] ?? [];

    // Spawn 4 NPCs
    const npcConfigs: { id: string; tileX: number; tileY: number }[] = [
      { id: "nuria", tileX: 3, tileY: 18 },
      { id: "serena", tileX: 6, tileY: 18 },
      { id: "diego", tileX: 9, tileY: 18 },
      { id: "grafico", tileX: 12, tileY: 18 },
    ];

    for (const cfg of npcConfigs) {
      const npcData = this.d[cfg.id];
      const isMyRole = roleNpcIds.includes(cfg.id);

      const messages = (): string[] => {
        if (isMyRole) {
          return npcData.talk;
        }
        const roleNpcNames: string = this.d.roleNpcNames[role] ?? "tu equipo";
        const redirect = (npcData.redirect as string)
          .replace("{role}", role)
          .replace("{npcs}", roleNpcNames);
        return [redirect];
      };

      this.annotateAudio(npcData, `office-${cfg.id}`);
      const npc: NpcData = this.spawnNpcAt(cfg.id, "npc1-down", cfg.tileX, cfg.tileY, messages);
      npc.walking = false;
    }

    EventBus.emit("current-scene-ready", this);
    EventBus.emit("request-scorm-data");

    if (this.fromScene === "BrandingScene") {
      this.playEntrance();
    }
  }

  private playEntrance() {
    this.startCutscene();
    const playerTileX = Math.floor(this.player.x / this.TILE);
    const playerTileY = Math.floor(this.player.y / this.TILE);
    const entryX = this.getOffscreenLeft();

    this.player.setPosition(entryX * this.TILE + this.TILE / 2, playerTileY * this.TILE + this.TILE / 2);

    const suviY = playerTileY - 1;
    const suviDialogs = this.cache.json.get("suvi-dialogs").ncp1;
    this.annotateAudio(suviDialogs, "suvi");
    const suvi = this.spawnNpcAt("suvi", "npc1-down", entryX, suviY,
      suviDialogs.roleIntro || ["Aquí está tu equipo. ¡Te dejo con ellos!"]
    );

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
        this.openForcedDialog("suvi-office-intro", suvi.messages as string[]);
      }
    };

    this.walkPlayerAlongPath(playerPath, checkBothDone);
    this.walkNpcAlongPath(suvi, suviPath, () => {
      suvi.walking = false;
      checkBothDone();
    });
  }

  protected onDialogClosed(npcId: string): void {
    if (npcId === "suvi-office-intro") {
      const suvi = this.npcs.get("suvi");
      if (suvi) {
        const exitX = this.getOffscreenLeft();
        const path: { x: number; y: number }[] = [];
        for (let x = suvi.tileX - 1; x >= exitX; x--) {
          path.push({ x, y: suvi.tileY });
        }
        this.walkNpcAlongPath(suvi, path, () => {
          this.removeNpc(suvi);
        });
      }
    }

    const role = this.learnerRole || "Diseñador instruccional";
    const roleNpcIds: string[] = this.d.roleNpcs[role] ?? [];

    if (roleNpcIds.includes(npcId) && !this.talkedRoleNpcs.has(npcId)) {
      this.talkedRoleNpcs.add(npcId);
      EventBus.emit("task-completed", `meet-role-${npcId}`);
      this.checkOfficeBadge(roleNpcIds);
    }
  }

  private checkOfficeBadge(roleNpcIds: string[]) {
    if (this.badgeAwarded) return;
    if (roleNpcIds.every(id => this.talkedRoleNpcs.has(id))) {
      this.badgeAwarded = true;
      EventBus.emit("badge-earned", this.d.badges["office"]);
    }
  }
}
