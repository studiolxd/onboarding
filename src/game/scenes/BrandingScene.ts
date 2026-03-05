import { EventBus } from "../EventBus";
import { BaseScene } from "./BaseScene";
import { SceneTransitionData } from "../types";

export class BrandingScene extends BaseScene {
  private fromScene: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private d: any;
  private talkedComunicacion = false;
  private talkedDiseno = false;
  private badgeAwarded = false;

  constructor() {
    super("BrandingScene");
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

    this.d = this.cache.json.get("branding-dialogs");
    this.annotateAudio(this.d["comunicacion"], "branding-comunicacion");
    this.annotateAudio(this.d["diseno"], "branding-diseno");

    // Comunicación NPC
    const comNpc = this.spawnNpcAt("comunicacion", "npc1-down", 4, 18, () => this.d["comunicacion"].talk);
    comNpc.walking = false;

    // Diseño NPC
    const disNpc = this.spawnNpcAt("diseno", "npc1-down", 8, 18, () => this.d["diseno"].talk);
    disNpc.walking = false;

    EventBus.emit("current-scene-ready", this);
    EventBus.emit("request-scorm-data");

    if (this.fromScene === "CompanyScene") {
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
      suviDialogs.brandingIntro || ["El equipo de diseño y comunicación te dará todos los detalles."]
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
        this.openForcedDialog("suvi-branding-intro", suvi.messages as string[]);
      }
    };

    this.walkPlayerAlongPath(playerPath, checkBothDone);
    this.walkNpcAlongPath(suvi, suviPath, () => {
      suvi.walking = false;
      checkBothDone();
    });
  }

  protected onDialogClosed(npcId: string): void {
    // Suvi walks away after intro
    if (npcId === "suvi-branding-intro") {
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

    if (npcId === "comunicacion" && !this.talkedComunicacion) {
      this.talkedComunicacion = true;
      EventBus.emit("task-completed", "learn-comunicacion");
      this.checkBrandingBadge();
    }

    if (npcId === "diseno" && !this.talkedDiseno) {
      this.talkedDiseno = true;
      EventBus.emit("task-completed", "learn-diseno");
      this.checkBrandingBadge();
    }
  }

  private checkBrandingBadge() {
    if (this.talkedComunicacion && this.talkedDiseno && !this.badgeAwarded) {
      this.badgeAwarded = true;
      const badgeData = this.cache.json.get("branding-dialogs").badges["branding"];
      EventBus.emit("badge-earned", badgeData);
    }
  }
}
