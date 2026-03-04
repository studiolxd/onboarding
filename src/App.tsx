import { useEffect, useRef, useState, useCallback } from 'react';
import { ScormProvider, useScorm, useScormAutoTerminate } from '@studiolxd/react-scorm';
import { IRefPhaserGame, PhaserGame } from './PhaserGame';
import { EventBus } from './game/EventBus';

interface Badge {
    id: string;
    name: string;
    description: string;
}

function GameWithScorm() {
    const { api } = useScorm();
    const phaserRef = useRef<IRefPhaserGame | null>(null);
    useScormAutoTerminate({ trackSessionTime: true, handleUnload: true, handleFreeze: true });

    const [badges, setBadges] = useState<Badge[]>([]);
    const [showBadges, setShowBadges] = useState(false);
    const [toast, setToast] = useState<string | null>(null);

    const addBadge = useCallback((badge: Badge) => {
        setBadges(prev => {
            if (prev.some(b => b.id === badge.id)) return prev;
            return [...prev, badge];
        });
        setToast(badge.name);
        setTimeout(() => setToast(null), 3000);
    }, []);

    useEffect(() => {
        if (!api) return;

        // Estado persistente en suspendData
        let savedState: { tileX?: number; tileY?: number; rol?: string; badges?: Badge[] } = {};

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
                    savedState = JSON.parse(suspendResult.value);
                    if (savedState.tileX != null && savedState.tileY != null) {
                        EventBus.emit('restore-position', { tileX: savedState.tileX, tileY: savedState.tileY });
                    }
                    if (savedState.rol) {
                        EventBus.emit('restore-role', savedState.rol);
                    }
                    // Restaurar badges
                    if (savedState.badges && savedState.badges.length > 0) {
                        setBadges(savedState.badges);
                    }
                } catch { /* ignore invalid JSON */ }
            }
        };

        // Posición: solo actualiza en memoria, sin commit
        const onSavePosition = (pos: { tileX: number; tileY: number }) => {
            savedState = { ...savedState, tileX: pos.tileX, tileY: pos.tileY };
            api.setSuspendData(JSON.stringify(savedState));
            api.setLocation(`${pos.tileX},${pos.tileY}`);
        };

        // Elección del jugador (rol, etc.)
        const onChoiceMade = (data: { npcId: string; choice: string }) => {
            savedState = { ...savedState, rol: data.choice };
            api.setSuspendData(JSON.stringify(savedState));
            api.commit();
        };

        // Badge eliminado (cambio de rol)
        const onBadgeRemoved = (data: { id: string }) => {
            setBadges(prev => prev.filter(b => b.id !== data.id));
            const currentBadges = savedState.badges ?? [];
            savedState = { ...savedState, badges: currentBadges.filter(b => b.id !== data.id) };
            api.setSuspendData(JSON.stringify(savedState));
        };

        // Badge ganado
        const onBadgeEarned = (badge: Badge) => {
            addBadge(badge);
            const currentBadges = savedState.badges ?? [];
            if (!currentBadges.some(b => b.id === badge.id)) {
                savedState = { ...savedState, badges: [...currentBadges, badge] };
                api.setSuspendData(JSON.stringify(savedState));
                api.commit();
            }
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
        EventBus.on('choice-made', onChoiceMade);
        EventBus.on('badge-earned', onBadgeEarned);
        EventBus.on('badge-removed', onBadgeRemoved);
        EventBus.on('npc-dialog-complete', onDialogComplete);
        EventBus.on('course-complete', onCourseComplete);

        return () => {
            EventBus.off('request-scorm-data', onRequestScormData);
            EventBus.off('save-position', onSavePosition);
            EventBus.off('choice-made', onChoiceMade);
            EventBus.off('badge-earned', onBadgeEarned);
            EventBus.off('badge-removed', onBadgeRemoved);
            EventBus.off('npc-dialog-complete', onDialogComplete);
            EventBus.off('course-complete', onCourseComplete);
        };
    }, [api, addBadge]);

    return (
        <div id="app">
            <PhaserGame ref={phaserRef} />

            <button
                className="badges-btn"
                onClick={() => setShowBadges(!showBadges)}
            >
                Badges{badges.length > 0 && ` (${badges.length})`}
            </button>

            {showBadges && (
                <div className="badges-panel">
                    <div className="badges-panel-header">
                        <span>Badges</span>
                        <button className="badges-close" onClick={() => setShowBadges(false)}>X</button>
                    </div>
                    {badges.length === 0 ? (
                        <p className="badges-empty">Aún no tienes badges</p>
                    ) : (
                        <div className="badges-list">
                            {badges.map(b => (
                                <div key={b.id} className="badge-item">
                                    <span className="badge-icon">🏆</span>
                                    <div>
                                        <div className="badge-name">{b.name}</div>
                                        <div className="badge-desc">{b.description}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {toast && (
                <div className="badge-toast">
                    🏆 {toast}
                </div>
            )}
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
