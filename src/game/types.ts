export interface NpcChoice {
  question: string;
  options: string[];
}

export interface NpcData {
  id: string;
  sprite: Phaser.GameObjects.Sprite;
  tileX: number;
  tileY: number;
  tiles: { x: number; y: number }[];
  messages: string[] | (() => string[]);
  choice?: NpcChoice | (() => NpcChoice | undefined);
  walking?: boolean;
}

export interface SceneTransitionData {
  learnerName: string;
  displayName: string;
  learnerRole: string;
  genderPref: "masculino" | "femenino" | "neutro" | "";
  visitedSuvi: boolean;
  visitedHr1: boolean;
  visitedHr2: boolean;
  visitedHr3: boolean;
  talkedTo: string[];
  fromScene?: string;
  entryPoint?: string;
}
