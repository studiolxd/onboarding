import { useEffect, useRef } from 'react';
import { ScormProvider, useScorm } from '@studiolxd/react-scorm';
import { IRefPhaserGame, PhaserGame } from './PhaserGame';
import { EventBus } from './game/EventBus';

function GameWithScorm() {
    const { api } = useScorm();
    const phaserRef = useRef<IRefPhaserGame | null>(null);

    useEffect(() => {
        if (!api) return;

        // Inicializar SCORM
        api.initialize();

        // Recuperar posición guardada
        const suspendResult = api.getSuspendData();
        if (suspendResult.ok && suspendResult.value) {
            try {
                const saved = JSON.parse(suspendResult.value);
                EventBus.emit('restore-position', saved);
            } catch { /* ignore invalid JSON */ }
        }

        // Enviar nombre del alumno al juego
        const nameResult = api.getLearnerName();
        if (nameResult.ok) {
            EventBus.emit('learner-name', nameResult.value);
        }

        // Escuchar eventos del juego
        const onDialogComplete = (_npcId: string) => {
            const scoreResult = api.getScore();
            const current = scoreResult.ok ? (scoreResult.value.raw ?? 0) : 0;
            api.setScore({ raw: current + 10, min: 0, max: 100 });
            api.commit();
        };

        const onSavePosition = (pos: { tileX: number; tileY: number }) => {
            api.setSuspendData(JSON.stringify(pos));
            api.setLocation(`${pos.tileX},${pos.tileY}`);
            api.commit();
        };

        const onCourseComplete = () => {
            api.setScore({ raw: 100, min: 0, max: 100 });
            api.setComplete();
            api.setPassed();
            api.commit();
        };

        EventBus.on('npc-dialog-complete', onDialogComplete);
        EventBus.on('save-position', onSavePosition);
        EventBus.on('course-complete', onCourseComplete);

        return () => {
            EventBus.off('npc-dialog-complete', onDialogComplete);
            EventBus.off('save-position', onSavePosition);
            EventBus.off('course-complete', onCourseComplete);
        };
    }, [api]);

    return (
        <div id="app">
            <PhaserGame ref={phaserRef} />
        </div>
    );
}

function App() {
    return (
        <ScormProvider version="1.2" options={{ noLmsBehavior: 'mock', debug: true }}>
            <GameWithScorm />
        </ScormProvider>
    );
}

export default App;
