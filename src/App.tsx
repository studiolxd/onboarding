import { useEffect, useRef } from 'react';
import { ScormProvider, useScorm, useScormAutoTerminate } from '@studiolxd/react-scorm';
import { IRefPhaserGame, PhaserGame } from './PhaserGame';
import { EventBus } from './game/EventBus';

function GameWithScorm() {
    const { api } = useScorm();
    const phaserRef = useRef<IRefPhaserGame | null>(null);
    useScormAutoTerminate({ trackSessionTime: true, handleUnload: true, handleFreeze: true });

    useEffect(() => {
        if (!api) return;

        // Cuando el juego pide datos SCORM (al terminar create())
        const onRequestScormData = () => {
            const statusResult = api.getCompletionStatus();
            if (statusResult.ok && statusResult.value === 'not attempted') {
                api.setIncomplete();
                api.commit();
            }

            const nameResult = api.getLearnerName();
            if (nameResult.ok) {
                EventBus.emit('learner-name', nameResult.value);
            }

            const suspendResult = api.getSuspendData();
            if (suspendResult.ok && suspendResult.value) {
                try {
                    const saved = JSON.parse(suspendResult.value);
                    EventBus.emit('restore-position', saved);
                } catch { /* ignore invalid JSON */ }
            }
        };

        // Posición: solo actualiza en memoria, sin commit
        const onSavePosition = (pos: { tileX: number; tileY: number }) => {
            api.setSuspendData(JSON.stringify(pos));
            api.setLocation(`${pos.tileX},${pos.tileY}`);
        };

        // Diálogo completado: actualiza score y hace commit (posición + score)
        const onDialogComplete = (_npcId: string) => {
            const scoreResult = api.getScore();
            const current = scoreResult.ok ? (scoreResult.value.raw ?? 0) : 0;
            api.setScore({ raw: current + 10, min: 0, max: 100 });
            api.commit();
        };

        // Curso completado: marca y hace commit
        const onCourseComplete = () => {
            api.setScore({ raw: 100, min: 0, max: 100 });
            api.setComplete();
            api.commit();
        };

        EventBus.on('request-scorm-data', onRequestScormData);
        EventBus.on('save-position', onSavePosition);
        EventBus.on('npc-dialog-complete', onDialogComplete);
        EventBus.on('course-complete', onCourseComplete);

        return () => {
            EventBus.off('request-scorm-data', onRequestScormData);
            EventBus.off('save-position', onSavePosition);
            EventBus.off('npc-dialog-complete', onDialogComplete);
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
