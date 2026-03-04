import { GameObjects, Scene } from 'phaser';
import { EventBus } from '../EventBus';

type MenuItem = {
  label: string;
  action: () => void;
  text: GameObjects.Text;
};

export class MainMenu extends Scene {
  background!: GameObjects.Image;
  logo!: GameObjects.Image;
  title!: GameObjects.Text;

  logoTween: Phaser.Tweens.Tween | null = null;

  private menuItems: MenuItem[] = [];
  private selectedIndex = 0;

  private keyUp!: Phaser.Input.Keyboard.Key;
  private keyDown!: Phaser.Input.Keyboard.Key;
  private keyEnter!: Phaser.Input.Keyboard.Key;
  private keySpace!: Phaser.Input.Keyboard.Key;

  constructor() {
    super('MainMenu');
  }

  create() {
    this.background = this.add.image(512, 384, 'background');
    this.logo = this.add.image(512, 300, 'logo').setDepth(100);

    this.title = this.add.text(512, 460, 'Main Menu', {
      fontFamily: 'Arial Black',
      fontSize: 38,
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 8,
      align: 'center'
    }).setOrigin(0.5).setDepth(100);

    // ✅ Teclas (crearlas aquí, no en preload)
    this.keyUp = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.UP);
    this.keyDown = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN);
    this.keyEnter = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    this.keySpace = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // ✅ Crear items del menú (por ahora solo START)
    this.createMenu();

    // Selección inicial
    this.setSelectedIndex(0);

    EventBus.emit('current-scene-ready', this);
  }

  update() {
    // Navegación
    if (Phaser.Input.Keyboard.JustDown(this.keyUp)) {
      this.setSelectedIndex((this.selectedIndex - 1 + this.menuItems.length) % this.menuItems.length);
    }

    if (Phaser.Input.Keyboard.JustDown(this.keyDown)) {
      this.setSelectedIndex((this.selectedIndex + 1) % this.menuItems.length);
    }

    // Activar opción
    if (Phaser.Input.Keyboard.JustDown(this.keyEnter) || Phaser.Input.Keyboard.JustDown(this.keySpace)) {
      this.menuItems[this.selectedIndex].action();
    }
  }

  private createMenu() {
    const baseX = 512;
    const baseY = 540;
    const gap = 46;

    const makeItem = (label: string, index: number, action: () => void) => {
      const text = this.add.text(baseX, baseY + index * gap, label, {
        fontFamily: 'Arial Black',
        fontSize: 32,
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 6,
        align: 'center'
      })
        .setOrigin(0.5)
        .setDepth(100)
        .setInteractive({ useHandCursor: true });

      // Ratón: hover mueve selección (para que teclado+ratón estén sincronizados)
      text.on('pointerover', () => this.setSelectedIndex(index));
      text.on('pointerdown', () => action());

      this.menuItems.push({ label, action, text });
    };

    makeItem('START', 0, () => this.changeScene());

    // Si luego quieres más opciones:
    // makeItem('OPTIONS', 1, () => this.scene.start('Options'));
    // makeItem('CREDITS', 2, () => this.scene.start('Credits'));
  }

  private setSelectedIndex(index: number) {
    this.selectedIndex = index;

    // Reset estilos
    for (let i = 0; i < this.menuItems.length; i++) {
      const t = this.menuItems[i].text;
      if (i === this.selectedIndex) {
        t.setText(`> ${this.menuItems[i].label}`);
        t.setScale(1.07);
      } else {
        t.setText(this.menuItems[i].label);
        t.setScale(1);
      }
    }
  }

  changeScene() {
    if (this.logoTween) {
      this.logoTween.stop();
      this.logoTween = null;
    }

    // ⚠️ Asegúrate del nombre real de tu escena de juego:
    // si tu escena se llama 'World', cambia 'Game' por 'World'
    this.scene.start('Game');
  }

  moveLogo(vueCallback: ({ x, y }: { x: number; y: number }) => void) {
    if (this.logoTween) {
      if (this.logoTween.isPlaying()) this.logoTween.pause();
      else this.logoTween.play();
    } else {
      this.logoTween = this.tweens.add({
        targets: this.logo,
        x: { value: 750, duration: 3000, ease: 'Back.easeInOut' },
        y: { value: 80, duration: 1500, ease: 'Sine.easeOut' },
        yoyo: true,
        repeat: -1,
        onUpdate: () => {
          if (vueCallback) {
            vueCallback({ x: Math.floor(this.logo.x), y: Math.floor(this.logo.y) });
          }
        }
      });
    }
  }
}