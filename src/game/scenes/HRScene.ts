import { EventBus } from "../EventBus";
import { BaseScene } from "./BaseScene";
import { NpcChoice, SceneTransitionData } from "../types";

export class HRScene extends BaseScene {
  // Team
  private teamSpawned = false;
  private teamDismissed = false;
  private readonly teamNpcIds = ["diego", "nuria", "serena"];
  private lastHr1Choice: string | null = null;
  private singleTeamRespawn: string | null = null;
  private respawnTimeouts = new Map<string, Phaser.Time.TimerEvent>();
  private respawnedIds: string[] = [];

  // HR3 functions
  private hr3FunctionIndex = 0;

  private readonly roleFunctions: Record<string, { name: string; brief: string; detail: string }[]> = {
    "Diseñador instruccional": [
      { name: "Diseño de experiencias", brief: "Creas itinerarios de aprendizaje.", detail: "Usarás Articulate, Miro y Notion para diseñar experiencias que enganchan y tienen sentido pedagógico." },
      { name: "Guionización", brief: "Escribes los guiones de cada módulo.", detail: "Cada proyecto tiene su narrativa. Tú defines qué se cuenta, cómo y cuándo, adaptando el tono al público." },
      { name: "Evaluación", brief: "Diseñas las evaluaciones.", detail: "Creas rúbricas, cuestionarios y actividades que miden el aprendizaje real, no solo memorización." },
    ],
    "Diseñador gráfico": [
      { name: "Diseño de interfaces", brief: "Diseñas las pantallas de los cursos.", detail: "Usarás Figma para crear interfaces intuitivas y atractivas que faciliten el aprendizaje." },
      { name: "Animación", brief: "Creas animaciones y motion graphics.", detail: "After Effects será tu herramienta principal para dar vida a los contenidos con animaciones profesionales." },
      { name: "Identidad visual", brief: "Defines el estilo visual de cada proyecto.", detail: "Cada proyecto tiene su personalidad. Tú defines paletas, tipografías y estilos que lo hacen único." },
    ],
    "Programador": [
      { name: "Desarrollo web", brief: "Programas las plataformas de aprendizaje.", detail: "Usarás VS Code, React y TypeScript para construir experiencias interactivas de alta calidad." },
      { name: "Integración", brief: "Conectas sistemas y APIs.", detail: "Integras LMS, SCORM, xAPI y otras tecnologías para que todo funcione como un reloj." },
      { name: "Gamificación técnica", brief: "Desarrollas mecánicas de juego.", detail: "Con Phaser y otras librerías, creas experiencias gamificadas que hacen el aprendizaje más divertido." },
    ],
  };

  private readonly teamConfig: {
    id: string;
    offsetX: number;
    offsetY: number;
    messages: string[];
    extraMessages: string[];
  }[] = [
    {
      id: "diego",
      offsetX: -2,
      offsetY: 0,
      messages: [
        "¡Qué tal! Soy Diego, socio y responsable de tecnología.",
        "Yo me encargo de que todo funcione.",
        "¡Cuenta conmigo para lo técnico!",
      ],
      extraMessages: [
        "Llevo muchos años en el mundo del desarrollo.",
        "Me apasiona la tecnología educativa.",
        "Si necesitas algo técnico, no dudes en preguntarme.",
      ],
    },
    {
      id: "nuria",
      offsetX: 2,
      offsetY: -1,
      messages: [
        "¡Hola! Soy Nuria, diseñadora instruccional.",
        "Diseño experiencias de aprendizaje que enganchan.",
        "¡Encantada de conocerte, {name}!",
      ],
      extraMessages: [
        "Me especializo en gamificación y storytelling.",
        "Cada proyecto es una oportunidad de innovar.",
        "¡Me encanta trabajar en equipo!",
      ],
    },
    {
      id: "serena",
      offsetX: 2,
      offsetY: 1,
      messages: [
        "¡Hey! Soy Serena, también diseñadora instruccional.",
        "Me encanta crear contenido interactivo.",
        "¡Bienvenido/a al equipo!",
      ],
      extraMessages: [
        "Vengo del mundo de la educación formal.",
        "Aquí he descubierto nuevas formas de enseñar.",
        "¡Seguro que vamos a hacer cosas geniales juntos!",
      ],
    },
  ];

  // Finale
  private finaleTriggered = false;

  constructor() {
    super("HRScene");
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

    // HR-specific restore: team state
    EventBus.on("restore-progress", (progress: { visitedSuvi?: boolean; visitedHr1?: boolean; visitedHr2?: boolean; visitedHr3?: boolean }) => {
      if (progress.visitedHr1) {
        this.teamSpawned = true;
        this.teamDismissed = true;
      }
    });

    // --- NPCs ---
    this.spawnNpc(objLayer, "hr1", "npc1-down", () => {
      if (!this.visitedHr1) {
        return [
          "¡Hola, {name}! Soy de RRHH.",
          "Voy a presentarte al equipo. ¡Espera un momento!",
        ];
      }
      return ["¡Hola de nuevo, {name}!", "¿Quieres que te presente a alguien?"];
    }, { tileX: 17, tileY: 20 }, () => {
      if (!this.visitedHr1) return undefined;

      const available = this.teamConfig
        .filter((c) => !this.npcs.has(c.id))
        .map((c) => c.id.charAt(0).toUpperCase() + c.id.slice(1));

      if (available.length === 0) return undefined;

      const options = available.length === this.teamConfig.length
        ? ["No, gracias", "Todo el equipo", ...available]
        : available.length > 1
          ? ["No, gracias", "Todos los disponibles", ...available]
          : ["No, gracias", ...available];

      return {
        question: "¿A quién quieres conocer?",
        options,
      };
    });

    // HR2: forma de trabajar
    this.spawnNpc(objLayer, "hr2", "npc1-down", () => {
      if (!this.visitedHr2) {
        const redirect = this.visitedHr1
          ? "Ahora ve a hablar con RRHH para conocer tu rol."
          : "Ahora ve a conocer al equipo. Habla con la otra persona de RRHH.";
        return [
          "¡Hola, {name}! Soy de RRHH también.",
          "Te cuento cómo trabajamos aquí.",
          "Trabajamos en remoto la mayor parte del tiempo.",
          "Nos organizamos por proyectos, cada uno con su equipo.",
          "Y tenemos horarios flexibles: lo importante son los resultados.",
          redirect,
        ];
      }
      return ["¡Hola de nuevo! ¿Quieres saber algo más?"];
    }, { tileX: 20, tileY: 16 }, () => {
      if (!this.visitedHr2) return undefined;
      return {
        question: "¿Qué quieres saber?",
        options: ["Nada, gracias", "Teletrabajo", "Trabajo flexible", "Trabajo por proyectos"],
      };
    });

    // HR3: rol + funciones
    this.spawnNpc(objLayer, "hr3", "npc1-down", () => {
      if (!this.visitedHr1 || !this.visitedHr2) {
        return [
          "Primero ve a conocer al equipo y cómo trabajamos.",
        ];
      }
      if (!this.learnerRole) {
        return [
          "¡Hola, {name}!",
          "Antes de seguir, necesito saber algo...",
        ];
      }
      return [
        `¡Ey, {name}! Tu rol actual es: ${this.learnerRole}.`,
        "¿Necesitas algo?",
      ];
    }, { tileX: 22, tileY: 24 }, () => {
      if (!this.visitedHr1 || !this.visitedHr2) return undefined;
      if (this.learnerRole) {
        return {
          question: "¿Qué quieres hacer?",
          options: ["Nada, gracias", "Cambiar rol", "Consultar funciones"],
        };
      }
      return {
        question: "¿Cuál es tu rol en la empresa?",
        options: ["Diseñador instruccional", "Diseñador gráfico", "Programador"],
      };
    });

    EventBus.emit("current-scene-ready", this);
    EventBus.emit("request-scorm-data");
  }

  // ─── Hook overrides ───

  protected onChoiceConfirmed(npcId: string, choice: string): boolean {
    if (npcId === "hr1") {
      this.lastHr1Choice = choice;
      return false; // Let closeDialog handle the rest
    }

    if (npcId === "hr2") {
      if (choice === "Nada, gracias") return false;
      const topics: Record<string, string[]> = {
        "Teletrabajo": [
          "Trabajamos en remoto la mayor parte del tiempo.",
          "Usamos Slack y Meet para comunicarnos.",
          "Cada uno organiza su espacio como prefiera.",
        ],
        "Trabajo flexible": [
          "No tenemos horarios fijos.",
          "Lo importante son los resultados, no las horas.",
          "Puedes organizar tu día como mejor te convenga.",
        ],
        "Trabajo por proyectos": [
          "Nos organizamos por proyectos.",
          "Cada proyecto tiene su equipo y su líder.",
          "Así cada persona puede aportar donde más valor dé.",
        ],
      };
      this.talkQueue = topics[choice] ?? ["¡Buena elección!"];
      this.talkIndex = 0;
      this.showLine();
      return true;
    }

    // Team member choices
    if (this.teamNpcIds.includes(npcId)) {
      if (choice === "Cuéntame más") {
        const cfg = this.teamConfig.find((c) => c.id === npcId);
        if (cfg) {
          this.talkQueue = cfg.extraMessages;
          this.talkIndex = 0;
          this.showLine();
        } else {
          return false;
        }
        return true;
      }
      return false; // "Encantado de conocerte" → close
    }

    if (npcId === "hr3") {
      return this.handleHr3Choice(choice);
    }

    return false;
  }

  protected onDialogClosed(npcId: string): void {
    if (npcId === "hr1-welcome") {
      EventBus.emit("badge-earned", {
        id: "team-member",
        name: "Miembro del equipo",
        description: "Has conocido a todo el equipo",
      });
    }
    if (npcId === "hr1" && !this.teamSpawned) {
      this.spawnTeam();
    }
    if (this.teamNpcIds.includes(npcId) && !this.visitedHr1 && this.allTeamTalkedTo()) {
      this.dismissTeam();
      this.triggerHr1Welcome();
    }
    if (npcId === "hr2") {
      this.visitedHr2 = true;
      EventBus.emit("progress-updated", { visitedHr2: true });
    }
    if (npcId === "hr3") {
      this.resetHr3Choice();
    }

    // HR1 re-presentación
    if (npcId === "hr1" && this.visitedHr1 && this.lastHr1Choice && this.lastHr1Choice !== "No, gracias") {
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

    // Finale check
    if (npcId === "hr-finale") {
      // Transition to ITScene
      const data = this.getTransitionData();
      data.fromScene = "HRScene";
      EventBus.emit("scene-changed", "ITScene");
      this.scene.start("ITScene", data);
    } else {
      this.checkFinale();
    }
  }

  // ─── HR3 helpers ───

  private handleHr3Choice(choice: string): boolean {
    if (choice === "Cambiar rol") {
      const allRoles = ["Diseñador instruccional", "Diseñador gráfico", "Programador"];
      const otherRoles = allRoles.filter((r) => r !== this.learnerRole);
      this.showChoices({
        question: "¿A qué rol quieres cambiar? Perderás tu badge actual.",
        options: otherRoles,
      });
      return true;
    }

    if (choice === "Consultar funciones") {
      this.hr3FunctionIndex = 0;
      this.showNextFunction();
      return true;
    }

    if (choice === "Saber más") {
      const funcs = this.roleFunctions[this.learnerRole] ?? [];
      const fn = funcs[this.hr3FunctionIndex];
      if (fn) {
        this.hr3FunctionIndex++;
        this.talkQueue = [fn.detail];
        this.talkIndex = 0;
        this.showLine();
        this.prepareNextFunctionChoice();
      }
      return true;
    }

    if (choice === "Ok, siguiente") {
      this.hr3FunctionIndex++;
      this.showNextFunction();
      return true;
    }

    // Role selection
    const allRoles = ["Diseñador instruccional", "Diseñador gráfico", "Programador"];
    if (allRoles.includes(choice)) {
      if (this.learnerRole) {
        const oldBadgeId = `rol-${this.learnerRole.toLowerCase().replace(/ /g, "-")}`;
        EventBus.emit("badge-removed", { id: oldBadgeId });
      }

      this.learnerRole = choice;
      EventBus.emit("choice-made", { npcId: "hr3", choice });
      EventBus.emit("badge-earned", {
        id: `rol-${choice.toLowerCase().replace(/ /g, "-")}`,
        name: choice,
        description: `Tu rol: ${choice}`,
      });

      if (!this.visitedHr3) {
        this.hr3FunctionIndex = 0;
        const funcs = this.roleFunctions[choice] ?? [];
        if (funcs.length > 0) {
          const npc = this.npcs.get("hr3");
          if (npc) {
            npc.choice = {
              question: `${funcs[0].name}: ${funcs[0].brief}`,
              options: ["Saber más", "Ok, siguiente"],
            };
          }
        }
        this.talkQueue = [`¡${choice}! Genial. Te explico tus funciones.`];
        this.talkIndex = 0;
        this.showLine();
      } else {
        return false; // close dialog
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
        options: ["Saber más", "Ok, siguiente"],
      };
    }
  }

  private showNextFunction() {
    const funcs = this.roleFunctions[this.learnerRole] ?? [];
    if (this.hr3FunctionIndex >= funcs.length) {
      if (!this.visitedHr3) {
        this.visitedHr3 = true;
        EventBus.emit("progress-updated", { visitedHr3: true });
      }
      const npc = this.npcs.get("hr3");
      if (npc) npc.choice = undefined;
      this.talkQueue = ["¡Ya conoces todas tus funciones!"];
      this.talkIndex = 0;
      this.showLine();
      return;
    }
    const fn = funcs[this.hr3FunctionIndex];
    this.talkQueue = [`${fn.name}: ${fn.brief}`];
    this.talkIndex = 0;
    this.showLine();
    const npc = this.npcs.get("hr3");
    if (npc) {
      npc.choice = {
        question: `${fn.name}: ${fn.brief}`,
        options: ["Saber más", "Ok, siguiente"],
      };
    }
  }

  private resetHr3Choice() {
    const npc = this.npcs.get("hr3");
    if (npc) {
      npc.choice = () => {
        if (!this.visitedHr1 || !this.visitedHr2) return undefined;
        if (this.learnerRole) {
          return {
            question: "¿Qué quieres hacer?",
            options: ["Cambiar rol", "Consultar funciones"],
          };
        }
        return {
          question: "¿Cuál es tu rol en la empresa?",
          options: ["Diseñador instruccional", "Diseñador gráfico", "Programador"],
        };
      };
    }
  }

  // ─── Team management ───

  private allTeamTalkedTo(): boolean {
    return this.teamNpcIds.every((id) => this.talkedTo.has(id));
  }

  private teamMemberChoice(): NpcChoice {
    return {
      question: "¿Qué quieres hacer?",
      options: ["Cuéntame más", "Encantado de conocerte"],
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

      const npc = this.spawnNpcAt(cfg.id, "player-down", spawnX, spawnY, cfg.messages, this.teamMemberChoice());

      this.time.delayedCall(i * 300, () => {
        const path = this.findPathForNpc(spawnX, spawnY, destX, destY, npc);
        if (path.length > 0) {
          this.walkNpcAlongPath(npc, path, () => {
            npc.walking = false;
          });
        } else {
          this.teleportNpc(npc, destX, destY);
          npc.walking = false;
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

      const npc = this.spawnNpcAt(cfg.id, "player-down", spawnX, spawnY, cfg.messages, this.teamMemberChoice());

      this.time.delayedCall(i * 300, () => {
        const path = this.findPathForNpc(spawnX, spawnY, destX, destY, npc);
        if (path.length > 0) {
          this.walkNpcAlongPath(npc, path, () => {
            npc.walking = false;
          });
        } else {
          this.teleportNpc(npc, destX, destY);
          npc.walking = false;
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

    if (choice === "Todo el equipo" || choice === "Todos los disponibles") {
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
      });
    } else {
      this.teleportNpc(npc, destX, destY);
      npc.walking = false;
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
    EventBus.emit("progress-updated", { visitedHr1: true });

    this.time.delayedCall(1500, () => {
      const redirect = !this.visitedHr2
        ? "Ahora ve a conocer cómo trabajamos. Habla con la otra persona de RRHH."
        : "Ahora ve a hablar con RRHH para conocer tu rol y funciones.";
      this.openForcedDialog("hr1-welcome", [
        "¡Ya conoces a todo el equipo!",
        "¡Ya eres miembro del equipo, {name}!",
        redirect,
      ]);
    });
  }

  // ─── Finale ───

  private checkFinale() {
    if (this.finaleTriggered) return;
    if (!this.visitedHr1 || !this.visitedHr2 || !this.visitedHr3) return;
    this.finaleTriggered = true;

    this.time.delayedCall(500, () => {
      this.openForcedDialog("hr-finale", [
        "¡{name}! Ya estás listo/a.",
        "Has conocido al equipo, sabes cómo trabajamos y conoces tu rol.",
        "Ahora toca ir a IT para terminar tu incorporación.",
      ]);
    });
  }
}
