import { Boot } from './scenes/Boot';
import { GameOver } from './scenes/GameOver';
import { HRScene } from './scenes/HRScene';
import { SuviScene } from './scenes/SuviScene';
import { ITScene } from './scenes/ITScene';
import { CoffeeScene } from './scenes/CoffeeScene';
import { PRLScene } from './scenes/PRLScene';
import { DisconnectScene } from './scenes/DisconnectScene';
import { HarassmentScene } from './scenes/HarassmentScene';
import { CompanyScene } from './scenes/CompanyScene';
import { BrandingScene } from './scenes/BrandingScene';
import { OfficeScene } from './scenes/OfficeScene';
import { MainMenu } from './scenes/MainMenu';
import { AUTO, Game } from 'phaser';
import { Preloader } from './scenes/Preloader';

//  Find out more information about the Game Config at:
//  https://docs.phaser.io/api-documentation/typedef/types-core#gameconfig
const config: Phaser.Types.Core.GameConfig = {
    type: AUTO,
    parent: 'game-container',
    backgroundColor: '#000',
    scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: '100%',
        height: '100%',
    },
    scene: [
        Boot,
        Preloader,
        MainMenu,
        SuviScene,
        HRScene,
        ITScene,
        CoffeeScene,
        PRLScene,
        DisconnectScene,
        HarassmentScene,
        CompanyScene,
        BrandingScene,
        OfficeScene,
        GameOver
    ]
};

const StartGame = (parent: string) => {

    return new Game({ ...config, parent });

}

export default StartGame;
