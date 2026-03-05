import { Scene } from 'phaser';

export class Preloader extends Scene
{
    constructor ()
    {
        super('Preloader');
    }

    init ()
    {
        this.add.image(512, 384, 'background');

        this.add.rectangle(512, 384, 468, 32).setStrokeStyle(1, 0xffffff);

        const bar = this.add.rectangle(512-230, 384, 4, 28, 0xffffff);

        this.load.on('progress', (progress: number) => {
            bar.width = 4 + (460 * progress);
        });
    }

    preload ()
    {
        this.load.setPath('assets');

        this.load.image('logo', 'logo.png');
        this.load.image('star', 'star.png');

        // Game assets
        this.load.tilemapTiledJSON("map", "maps/map.json");
        this.load.image("dungeon", "tilesets/tiles.png");

        this.load.spritesheet("player-up", "characters/hero/hero_up.png", {
            frameWidth: 64,
            frameHeight: 64,
        });
        this.load.spritesheet("player-down", "characters/hero/hero_down.png", {
            frameWidth: 64,
            frameHeight: 64,
        });
        this.load.spritesheet("player-left", "characters/hero/hero_side.png", {
            frameWidth: 64,
            frameHeight: 64,
        });

        this.load.spritesheet("npc1-down", "characters/npc1/ncp1_down.png", {
            frameWidth: 64,
            frameHeight: 64,
        });

        this.load.spritesheet("computer", "props/computer.png", {
            frameWidth: 16,
            frameHeight: 16,
        });

        // Dialog data (reset path — these are in public/data/, not public/assets/)
        this.load.setPath('');
        this.load.json("common-dialogs", "data/common-dialogs.json");
        this.load.json("suvi-dialogs", "data/suvi-dialogs.json");
        this.load.json("hr-dialogs", "data/hr-dialogs.json");
        this.load.json("it-dialogs", "data/it-dialogs.json");
        this.load.json("coffee-dialogs", "data/coffee-dialogs.json");
        this.load.json("prl-dialogs", "data/prl-dialogs.json");
        this.load.json("disconnect-dialogs", "data/disconnect-dialogs.json");
    }

    create ()
    {
        this.createAnims();
        this.scene.start('ITScene');
    }

    private createAnims() {
        if (this.anims.exists("walk-down")) return;

        this.anims.create({
            key: "walk-down",
            frames: this.anims.generateFrameNumbers("player-down", { start: 0, end: 5 }),
            frameRate: 10,
            repeat: -1,
        });
        this.anims.create({
            key: "walk-up",
            frames: this.anims.generateFrameNumbers("player-up", { start: 0, end: 5 }),
            frameRate: 10,
            repeat: -1,
        });
        this.anims.create({
            key: "walk-left",
            frames: this.anims.generateFrameNumbers("player-left", { start: 0, end: 5 }),
            frameRate: 10,
            repeat: -1,
        });

        this.anims.create({
            key: "computer-anim",
            frames: this.anims.generateFrameNumbers("computer", { start: 0, end: 7 }),
            frameRate: 8,
            repeat: -1,
        });

        this.anims.create({
            key: "npc-walk-down",
            frames: this.anims.generateFrameNumbers("player-down", { start: 0, end: 5 }),
            frameRate: 10,
            repeat: -1,
        });
        this.anims.create({
            key: "npc-walk-up",
            frames: this.anims.generateFrameNumbers("player-up", { start: 0, end: 5 }),
            frameRate: 10,
            repeat: -1,
        });
        this.anims.create({
            key: "npc-walk-left",
            frames: this.anims.generateFrameNumbers("player-left", { start: 0, end: 5 }),
            frameRate: 10,
            repeat: -1,
        });
    }
}
