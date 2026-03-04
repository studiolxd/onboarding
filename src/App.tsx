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
    const [showNameInput, setShowNameInput] = useState(false);
    const [nameValue, setNameValue] = useState('');
    const [showNav, setShowNav] = useState(false);
    const [currentScene, setCurrentScene] = useState('SuviScene');
    const [visitedSuvi, setVisitedSuvi] = useState(false);
    const [allHrDone, setAllHrDone] = useState(false);
    const [mobileChoices, setMobileChoices] = useState<{ question: string; options: string[] } | null>(null);
    const nameInputRef = useRef<HTMLInputElement | null>(null);

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
        let savedState: {
            tileX?: number; tileY?: number; rol?: string; badges?: Badge[];
            displayName?: string; genderPref?: string; visitedSuvi?: boolean; visitedHr1?: boolean;
            visitedHr2?: boolean; visitedHr3?: boolean; currentScene?: string;
        } = {};

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
                    if (savedState.displayName) {
                        EventBus.emit('restore-display-name', savedState.displayName);
                    }
                    if (savedState.genderPref) {
                        EventBus.emit('restore-gender', savedState.genderPref);
                    }
                    if (savedState.visitedSuvi || savedState.visitedHr1 || savedState.visitedHr2 || savedState.visitedHr3) {
                        EventBus.emit('restore-progress', {
                            visitedSuvi: savedState.visitedSuvi,
                            visitedHr1: savedState.visitedHr1,
                            visitedHr2: savedState.visitedHr2,
                            visitedHr3: savedState.visitedHr3,
                        });
                        if (savedState.visitedSuvi) setVisitedSuvi(true);
                        if (savedState.visitedHr1 && savedState.visitedHr2 && savedState.visitedHr3) setAllHrDone(true);
                    }
                    if (savedState.currentScene) setCurrentScene(savedState.currentScene);
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

        // Nombre cambiado
        const onNameChanged = (name: string) => {
            savedState = { ...savedState, displayName: name };
            api.setSuspendData(JSON.stringify(savedState));
            api.commit();
        };

        // Género cambiado
        const onGenderChanged = (pref: string) => {
            savedState = { ...savedState, genderPref: pref };
            api.setSuspendData(JSON.stringify(savedState));
            api.commit();
        };

        // Progreso actualizado
        const onProgressUpdated = (progress: { visitedSuvi?: boolean; visitedHr1?: boolean; visitedHr2?: boolean; visitedHr3?: boolean }) => {
            savedState = { ...savedState, ...progress };
            api.setSuspendData(JSON.stringify(savedState));
            api.commit();
            if (progress.visitedSuvi) setVisitedSuvi(true);
            const vs = savedState.visitedSuvi || progress.visitedSuvi;
            const h1 = savedState.visitedHr1 || progress.visitedHr1;
            const h2 = savedState.visitedHr2 || progress.visitedHr2;
            const h3 = savedState.visitedHr3 || progress.visitedHr3;
            if (vs) setVisitedSuvi(true);
            if (h1 && h2 && h3) setAllHrDone(true);
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

        const onSceneChanged = (sceneName: string) => {
            setCurrentScene(sceneName);
            savedState = { ...savedState, currentScene: sceneName };
            api.setSuspendData(JSON.stringify(savedState));
            api.commit();
        };

        EventBus.on('request-scorm-data', onRequestScormData);
        EventBus.on('save-position', onSavePosition);
        EventBus.on('choice-made', onChoiceMade);
        EventBus.on('badge-earned', onBadgeEarned);
        EventBus.on('badge-removed', onBadgeRemoved);
        EventBus.on('name-changed', onNameChanged);
        EventBus.on('gender-changed', onGenderChanged);
        EventBus.on('progress-updated', onProgressUpdated);
        EventBus.on('npc-dialog-complete', onDialogComplete);
        EventBus.on('course-complete', onCourseComplete);
        EventBus.on('scene-changed', onSceneChanged);

        return () => {
            EventBus.off('request-scorm-data', onRequestScormData);
            EventBus.off('save-position', onSavePosition);
            EventBus.off('choice-made', onChoiceMade);
            EventBus.off('badge-earned', onBadgeEarned);
            EventBus.off('badge-removed', onBadgeRemoved);
            EventBus.off('name-changed', onNameChanged);
            EventBus.off('gender-changed', onGenderChanged);
            EventBus.off('progress-updated', onProgressUpdated);
            EventBus.off('npc-dialog-complete', onDialogComplete);
            EventBus.off('course-complete', onCourseComplete);
            EventBus.off('scene-changed', onSceneChanged);
        };
    }, [api, addBadge]);

    useEffect(() => {
        const onShow = () => {
            setNameValue('');
            setShowNameInput(true);
            setTimeout(() => nameInputRef.current?.focus(), 100);
        };
        const onHide = () => {
            setShowNameInput(false);
        };
        const onShowChoices = (data: { question: string; options: string[] }) => {
            setMobileChoices(data);
        };
        const onHideChoices = () => {
            setMobileChoices(null);
        };
        EventBus.on('show-name-input', onShow);
        EventBus.on('hide-name-input', onHide);
        EventBus.on('show-choices', onShowChoices);
        EventBus.on('hide-choices', onHideChoices);
        return () => {
            EventBus.off('show-name-input', onShow);
            EventBus.off('hide-name-input', onHide);
            EventBus.off('show-choices', onShowChoices);
            EventBus.off('hide-choices', onHideChoices);
        };
    }, []);

    const handleNameSubmit = () => {
        const trimmed = nameValue.trim();
        if (trimmed.length > 0) {
            setShowNameInput(false);
            EventBus.emit('name-input-confirmed', trimmed);
        }
    };

    return (
        <div id="app">
            <PhaserGame ref={phaserRef} />

            <button
                className="nav-map-btn"
                disabled={!visitedSuvi}
                onClick={() => { setShowNav(!showNav); setShowBadges(false); }}
            >
                Mapa
            </button>

            {showNav && visitedSuvi && (
                <div className="nav-map-panel">
                    <button
                        className={`nav-map-item${currentScene === 'SuviScene' ? ' nav-map-item--active' : ''}`}
                        onClick={() => { EventBus.emit('navigate-to-scene', 'SuviScene'); setShowNav(false); }}
                    >
                        Director
                    </button>
                    <button
                        className={`nav-map-item${currentScene === 'HRScene' ? ' nav-map-item--active' : ''}`}
                        onClick={() => { EventBus.emit('navigate-to-scene', 'HRScene'); setShowNav(false); }}
                    >
                        RRHH
                    </button>
                    <button
                        className={`nav-map-item${!allHrDone ? ' nav-map-item--locked' : ''}${currentScene === 'ITScene' ? ' nav-map-item--active' : ''}`}
                        disabled={!allHrDone}
                        onClick={() => { if (allHrDone) { EventBus.emit('navigate-to-scene', 'ITScene'); setShowNav(false); } }}
                    >
                        IT{!allHrDone ? ' (bloqueado)' : ''}
                    </button>
                </div>
            )}

            <button
                className="badges-btn"
                onClick={() => { setShowBadges(!showBadges); setShowNav(false); }}
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

            {mobileChoices && (
                <div className="choices-overlay">
                    {mobileChoices.options.map((opt, i) => (
                        <button
                            key={i}
                            className="choices-overlay-btn"
                            onClick={() => {
                                setMobileChoices(null);
                                EventBus.emit('choice-selected', i);
                            }}
                        >
                            {i + 1}. {opt}
                        </button>
                    ))}
                </div>
            )}

            {showNameInput && (
                <div className="name-input-overlay">
                    <input
                        ref={nameInputRef}
                        type="text"
                        value={nameValue}
                        onChange={e => setNameValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleNameSubmit(); }}
                        placeholder="Escribe tu nombre..."
                        maxLength={20}
                        autoComplete="off"
                    />
                    <button onClick={handleNameSubmit}>OK</button>
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
