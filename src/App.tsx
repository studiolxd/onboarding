import { useEffect, useRef, useState, useCallback } from 'react';
import { ScormProvider, useScorm, useScormAutoTerminate } from '@studiolxd/react-scorm';
import { IRefPhaserGame, PhaserGame } from './PhaserGame';
import { ComputerScreen } from './ComputerScreen';
import { PRLInfoPanel } from './PRLInfoPanel';
import { EventBus } from './game/EventBus';

interface Badge {
    id: string;
    name: string;
    description: string;
}

interface GameTask {
    id: string;
    name: string;
    scene: string;
    requires?: string[];
}

type ToastType = 'badge-earned' | 'badge-lost' | 'task-completed' | 'task-assigned';

interface ToastItem {
    type: ToastType;
    message: string;
    key: number;
}

const TOAST_DURATION = 3000;

function GameWithScorm() {
    const { api } = useScorm();
    const phaserRef = useRef<IRefPhaserGame | null>(null);
    useScormAutoTerminate({ trackSessionTime: true, handleUnload: true, handleFreeze: true });

    const [badges, setBadges] = useState<Badge[]>([]);
    const [showBadges, setShowBadges] = useState(false);
    const [showNameInput, setShowNameInput] = useState(false);
    const [nameValue, setNameValue] = useState('');
    const [showNav, setShowNav] = useState(false);
    const [currentScene, setCurrentScene] = useState('SuviScene');
    const [visitedSuvi, setVisitedSuvi] = useState(false);
    const [allHrDone, setAllHrDone] = useState(false);
    const [allItDone, setAllItDone] = useState(false);
    const [allPrlDone, setAllPrlDone] = useState(false);
    const [allDisconnectDone, setAllDisconnectDone] = useState(false);
    const [allHarassmentDone, setAllHarassmentDone] = useState(false);
    const [allCompanyDone, setAllCompanyDone] = useState(false);
    const [allBrandingDone, setAllBrandingDone] = useState(false);
    const [taskDefs, setTaskDefs] = useState<GameTask[]>([]);
    const taskDefsRef = useRef<GameTask[]>([]);
    const [completedTasks, setCompletedTasks] = useState<string[]>([]);
    const [showSettings, setShowSettings] = useState(false);
    const [sfxEnabled, setSfxEnabled] = useState(true);
    const [dialogAudioEnabled, setDialogAudioEnabled] = useState(true);
    const nameInputRef = useRef<HTMLInputElement | null>(null);

    // ─── Toast queue ───
    const [activeToast, setActiveToast] = useState<ToastItem | null>(null);
    const toastQueue = useRef<ToastItem[]>([]);
    const toastCounter = useRef(0);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const processQueue = useCallback(() => {
        if (toastTimer.current) return; // already showing
        const next = toastQueue.current.shift();
        if (!next) return;
        setActiveToast(next);
        toastTimer.current = setTimeout(() => {
            setActiveToast(null);
            toastTimer.current = null;
            processQueue();
        }, TOAST_DURATION);
    }, []);

    const enqueueToast = useCallback((type: ToastType, message: string) => {
        toastQueue.current.push({ type, message, key: toastCounter.current++ });
        processQueue();
    }, [processQueue]);

    // Track announced tasks to detect newly available ones
    const announcedTasks = useRef<Set<string>>(new Set());

    /** Announce available (not yet announced) tasks for a given scene. */
    const announceTasksForScene = useCallback((scene: string, defs: GameTask[], completed: string[]) => {
        let newCount = 0;
        for (const t of defs) {
            if (t.scene !== scene) continue;
            if (announcedTasks.current.has(t.id)) continue;
            if (completed.includes(t.id)) {
                announcedTasks.current.add(t.id);
                continue;
            }
            if (!t.requires || t.requires.every(r => completed.includes(r))) {
                announcedTasks.current.add(t.id);
                newCount++;
            }
        }
        if (newCount > 0) {
            enqueueToast('task-assigned', newCount > 1 ? 'plural' : '');
        }
    }, [enqueueToast]);

    const addBadge = useCallback((badge: Badge) => {
        setBadges(prev => {
            if (prev.some(b => b.id === badge.id)) return prev;
            return [...prev, badge];
        });
        enqueueToast('badge-earned', badge.name);
    }, [enqueueToast]);

    useEffect(() => {
        if (!api) return;

        // Estado persistente en suspendData
        let savedState: {
            tileX?: number; tileY?: number; rol?: string; badges?: Badge[];
            displayName?: string; genderPref?: string; talkedTo?: string[];
            completedTasks?: string[]; currentScene?: string;
            watchedVideos?: string[];
            completedRisks?: string[];
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
                    // Restore talkedTo and derive visited flags
                    const tt = savedState.talkedTo ?? [];
                    const bb = savedState.badges ?? [];
                    if (tt.length > 0) {
                        EventBus.emit('restore-talked-to', tt);
                    }
                    const derivedVisitedSuvi = tt.includes('ncp1');
                    const derivedVisitedHr1 = bb.some(b => b.id === 'team-member');
                    const derivedVisitedHr2 = tt.includes('hr2');
                    const derivedVisitedHr3 = bb.some(b => b.id.startsWith('rol-'));
                    if (derivedVisitedSuvi || derivedVisitedHr1 || derivedVisitedHr2 || derivedVisitedHr3) {
                        EventBus.emit('restore-progress', {
                            visitedSuvi: derivedVisitedSuvi,
                            visitedHr1: derivedVisitedHr1,
                            visitedHr2: derivedVisitedHr2,
                            visitedHr3: derivedVisitedHr3,
                        });
                    }
                    if (derivedVisitedSuvi) setVisitedSuvi(true);
                    if (derivedVisitedHr1 && derivedVisitedHr2 && derivedVisitedHr3) setAllHrDone(true);
                    if (bb.some(b => b.id === 'data-security')) setAllItDone(true);
                    if (bb.some(b => b.id === 'safe-work')) setAllPrlDone(true);
                    if (bb.some(b => b.id === 'digital-disconnect')) setAllDisconnectDone(true);
                    if (bb.some(b => b.id === 'equality')) setAllHarassmentDone(true);
                    if (bb.some(b => b.id === 'company-culture')) setAllCompanyDone(true);
                    if (bb.some(b => b.id === 'branding')) setAllBrandingDone(true);
                    if (savedState.currentScene) setCurrentScene(savedState.currentScene);
                    // Restaurar badges
                    if (savedState.badges && savedState.badges.length > 0) {
                        setBadges(savedState.badges);
                    }
                    // Restaurar tareas completadas
                    if (savedState.completedTasks && savedState.completedTasks.length > 0) {
                        setCompletedTasks(savedState.completedTasks);
                        // Mark restored tasks as already announced
                        for (const id of savedState.completedTasks) {
                            announcedTasks.current.add(id);
                        }
                    }
                    // Restaurar vídeos vistos
                    if (savedState.watchedVideos && savedState.watchedVideos.length > 0) {
                        EventBus.emit('restore-watched-videos', savedState.watchedVideos);
                    }
                    // Restaurar riesgos PRL completados
                    if (savedState.completedRisks && savedState.completedRisks.length > 0) {
                        EventBus.emit('restore-completed-risks', savedState.completedRisks);
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
            setBadges(prev => {
                const removed = prev.find(b => b.id === data.id);
                if (removed) {
                    enqueueToast('badge-lost', removed.name);
                }
                return prev.filter(b => b.id !== data.id);
            });
            const currentBadges = savedState.badges ?? [];
            savedState = { ...savedState, badges: currentBadges.filter(b => b.id !== data.id) };
            api.setSuspendData(JSON.stringify(savedState));
        };

        // Badge ganado
        const onBadgeEarned = (badge: Badge) => {
            addBadge(badge);
            const currentBadges = savedState.badges ?? [];
            if (!currentBadges.some(b => b.id === badge.id)) {
                const newBadges = [...currentBadges, badge];
                savedState = { ...savedState, badges: newBadges };
                api.setSuspendData(JSON.stringify(savedState));
                api.commit();
                // Recalculate allHrDone when relevant badges are earned
                const tt = savedState.talkedTo ?? [];
                const h1 = newBadges.some(b => b.id === 'team-member');
                const h2 = tt.includes('hr2');
                const h3 = newBadges.some(b => b.id.startsWith('rol-'));
                if (h1 && h2 && h3) setAllHrDone(true);
                // Unlock PRL when data-security badge is earned
                if (newBadges.some(b => b.id === 'data-security')) setAllItDone(true);
                // Unlock Disconnect when safe-work badge is earned
                if (newBadges.some(b => b.id === 'safe-work')) setAllPrlDone(true);
                // Unlock Harassment when digital-disconnect badge is earned
                if (newBadges.some(b => b.id === 'digital-disconnect')) setAllDisconnectDone(true);
                if (newBadges.some(b => b.id === 'equality')) setAllHarassmentDone(true);
                if (newBadges.some(b => b.id === 'company-culture')) setAllCompanyDone(true);
                if (newBadges.some(b => b.id === 'branding')) setAllBrandingDone(true);
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

        // talkedTo actualizado
        const onTalkedToUpdated = (ids: string[]) => {
            savedState = { ...savedState, talkedTo: ids };
            api.setSuspendData(JSON.stringify(savedState));
            api.commit();
            if (ids.includes('ncp1')) setVisitedSuvi(true);
            // hr2 visited derived from talkedTo; allHrDone also needs badges (checked in onBadgeEarned)
            const bb = savedState.badges ?? [];
            const h1 = bb.some(b => b.id === 'team-member');
            const h2 = ids.includes('hr2');
            const h3 = bb.some(b => b.id.startsWith('rol-'));
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

        // Definiciones de tareas cargadas desde JSON
        const onTaskDefsLoaded = (defs: GameTask[]) => {
            taskDefsRef.current = defs;
            setTaskDefs(defs);
        };

        // Tarea completada
        const onTaskCompleted = (taskId: string) => {
            // Skip if already completed
            if ((savedState.completedTasks ?? []).includes(taskId)) return;

            setCompletedTasks(prev => {
                if (prev.includes(taskId)) return prev;
                const next = [...prev, taskId];
                savedState = { ...savedState, completedTasks: next };
                api.setSuspendData(JSON.stringify(savedState));
                api.commit();
                return next;
            });

            // Toast for completed task (outside state updater to avoid StrictMode double-fire)
            const defs = taskDefsRef.current;
            const task = defs.find(t => t.id === taskId);
            if (task) enqueueToast('task-completed', '');

            // Check for newly unlocked tasks in current scene only
            const completed = [...(savedState.completedTasks ?? []), taskId];
            const scene = savedState.currentScene ?? '';
            let newCount = 0;
            for (const t of defs) {
                if (t.scene !== scene) continue;
                if (announcedTasks.current.has(t.id)) continue;
                if (completed.includes(t.id)) continue;
                if (!t.requires || t.requires.every(r => completed.includes(r))) {
                    announcedTasks.current.add(t.id);
                    newCount++;
                }
            }
            if (newCount > 0) {
                enqueueToast('task-assigned', newCount > 1 ? 'plural' : '');
            }
        };

        const onSceneChanged = (sceneName: string) => {
            setCurrentScene(sceneName);
            savedState = { ...savedState, currentScene: sceneName };
            api.setSuspendData(JSON.stringify(savedState));
            api.commit();
        };

        const onVideoWatched = (videoId: string) => {
            const prev = savedState.watchedVideos ?? [];
            if (prev.includes(videoId)) return;
            savedState = { ...savedState, watchedVideos: [...prev, videoId] };
            api.setSuspendData(JSON.stringify(savedState));
            api.commit();
        };

        const onPrlInfoClosed = (riskId: string) => {
            const prev = savedState.completedRisks ?? [];
            if (prev.includes(riskId)) return;
            savedState = { ...savedState, completedRisks: [...prev, riskId] };
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
        EventBus.on('talked-to-updated', onTalkedToUpdated);
        EventBus.on('npc-dialog-complete', onDialogComplete);
        EventBus.on('course-complete', onCourseComplete);
        EventBus.on('scene-changed', onSceneChanged);
        EventBus.on('task-defs-loaded', onTaskDefsLoaded);
        EventBus.on('task-completed', onTaskCompleted);
        EventBus.on('video-watched', onVideoWatched);
        EventBus.on('prl-info-closed', onPrlInfoClosed);

        return () => {
            EventBus.off('request-scorm-data', onRequestScormData);
            EventBus.off('save-position', onSavePosition);
            EventBus.off('choice-made', onChoiceMade);
            EventBus.off('badge-earned', onBadgeEarned);
            EventBus.off('badge-removed', onBadgeRemoved);
            EventBus.off('name-changed', onNameChanged);
            EventBus.off('gender-changed', onGenderChanged);
            EventBus.off('talked-to-updated', onTalkedToUpdated);
            EventBus.off('npc-dialog-complete', onDialogComplete);
            EventBus.off('course-complete', onCourseComplete);
            EventBus.off('scene-changed', onSceneChanged);
            EventBus.off('task-defs-loaded', onTaskDefsLoaded);
            EventBus.off('task-completed', onTaskCompleted);
            EventBus.off('video-watched', onVideoWatched);
            EventBus.off('prl-info-closed', onPrlInfoClosed);
        };
    }, [api, addBadge, enqueueToast]);

    // Emit settings changes to Phaser
    useEffect(() => {
        EventBus.emit('settings-changed', { sfxEnabled, dialogAudioEnabled });
    }, [sfxEnabled, dialogAudioEnabled]);

    // Announce tasks for the current scene when taskDefs load or scene changes
    useEffect(() => {
        if (taskDefs.length === 0) return;
        announceTasksForScene(currentScene, taskDefs, completedTasks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [taskDefs, currentScene]);

    useEffect(() => {
        const onShow = () => {
            setNameValue('');
            setShowNameInput(true);
            setTimeout(() => nameInputRef.current?.focus(), 100);
        };
        const onHide = () => {
            setShowNameInput(false);
        };
        EventBus.on('show-name-input', onShow);
        EventBus.on('hide-name-input', onHide);
        return () => {
            EventBus.off('show-name-input', onShow);
            EventBus.off('hide-name-input', onHide);
        };
    }, []);

    const handleNameSubmit = () => {
        const trimmed = nameValue.trim();
        if (trimmed.length > 0) {
            setShowNameInput(false);
            EventBus.emit('name-input-confirmed', trimmed);
        }
    };

    const toastConfig: Record<ToastType, { icon: string; className: string; label: string }> = {
        'badge-earned': { icon: '\uD83C\uDFC6', className: 'toast toast--badge-earned', label: '\u00A1Has conseguido una nueva insignia!' },
        'badge-lost':   { icon: '\u2716',       className: 'toast toast--badge-lost', label: 'Insignia perdida' },
        'task-completed': { icon: '\u2713',      className: 'toast toast--task-completed', label: 'Tarea completada' },
        'task-assigned':  { icon: '',             className: 'toast toast--task-assigned', label: 'Tienes una nueva tarea' },
    };

    return (
        <div id="app">
            <PhaserGame ref={phaserRef} />
            <ComputerScreen />
            <PRLInfoPanel />

            <button
                className="settings-btn"
                onClick={() => { setShowSettings(!showSettings); setShowNav(false); setShowBadges(false); }}
            >
                Opciones
            </button>

            {showSettings && (
                <div className="settings-panel">
                    <div className="settings-panel-header">
                        <span>Opciones</span>
                        <button className="settings-close" onClick={() => setShowSettings(false)}>X</button>
                    </div>
                    <label className="settings-toggle">
                        <input
                            type="checkbox"
                            checked={dialogAudioEnabled}
                            onChange={e => setDialogAudioEnabled(e.target.checked)}
                        />
                        <span>Sonido de dialogos</span>
                    </label>
                    <label className="settings-toggle">
                        <input
                            type="checkbox"
                            checked={sfxEnabled}
                            onChange={e => setSfxEnabled(e.target.checked)}
                        />
                        <span>Efectos de sonido</span>
                    </label>
                </div>
            )}

            <button
                className="nav-map-btn"
                disabled={!visitedSuvi && currentScene === 'SuviScene'}
                onClick={() => { setShowNav(!showNav); setShowBadges(false); setShowSettings(false); }}
            >
                Mapa
            </button>

            {showNav && (visitedSuvi || currentScene !== 'SuviScene') && (
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
                        className={`nav-map-item${!allHrDone && currentScene !== 'ITScene' ? ' nav-map-item--locked' : ''}${currentScene === 'ITScene' ? ' nav-map-item--active' : ''}`}
                        disabled={!allHrDone && currentScene !== 'ITScene'}
                        onClick={() => { EventBus.emit('navigate-to-scene', 'ITScene'); setShowNav(false); }}
                    >
                        IT{!allHrDone && currentScene !== 'ITScene' ? ' (bloqueado)' : ''}
                    </button>
                    <button
                        className={`nav-map-item${!allItDone && currentScene !== 'PRLScene' ? ' nav-map-item--locked' : ''}${currentScene === 'PRLScene' ? ' nav-map-item--active' : ''}`}
                        disabled={!allItDone && currentScene !== 'PRLScene'}
                        onClick={() => { EventBus.emit('navigate-to-scene', 'PRLScene'); setShowNav(false); }}
                    >
                        PRL{!allItDone && currentScene !== 'PRLScene' ? ' (bloqueado)' : ''}
                    </button>
                    <button
                        className={`nav-map-item${!allPrlDone && currentScene !== 'DisconnectScene' ? ' nav-map-item--locked' : ''}${currentScene === 'DisconnectScene' ? ' nav-map-item--active' : ''}`}
                        disabled={!allPrlDone && currentScene !== 'DisconnectScene'}
                        onClick={() => { EventBus.emit('navigate-to-scene', 'DisconnectScene'); setShowNav(false); }}
                    >
                        Desconexión{!allPrlDone && currentScene !== 'DisconnectScene' ? ' (bloqueado)' : ''}
                    </button>
                    <button
                        className={`nav-map-item${!allDisconnectDone && currentScene !== 'HarassmentScene' ? ' nav-map-item--locked' : ''}${currentScene === 'HarassmentScene' ? ' nav-map-item--active' : ''}`}
                        disabled={!allDisconnectDone && currentScene !== 'HarassmentScene'}
                        onClick={() => { EventBus.emit('navigate-to-scene', 'HarassmentScene'); setShowNav(false); }}
                    >
                        Igualdad{!allDisconnectDone && currentScene !== 'HarassmentScene' ? ' (bloqueado)' : ''}
                    </button>
                    <button
                        className={`nav-map-item${!allHarassmentDone && currentScene !== 'CompanyScene' ? ' nav-map-item--locked' : ''}${currentScene === 'CompanyScene' ? ' nav-map-item--active' : ''}`}
                        disabled={!allHarassmentDone && currentScene !== 'CompanyScene'}
                        onClick={() => { EventBus.emit('navigate-to-scene', 'CompanyScene'); setShowNav(false); }}
                    >
                        Empresa{!allHarassmentDone && currentScene !== 'CompanyScene' ? ' (bloqueado)' : ''}
                    </button>
                    <button
                        className={`nav-map-item${!allCompanyDone && currentScene !== 'BrandingScene' ? ' nav-map-item--locked' : ''}${currentScene === 'BrandingScene' ? ' nav-map-item--active' : ''}`}
                        disabled={!allCompanyDone && currentScene !== 'BrandingScene'}
                        onClick={() => { EventBus.emit('navigate-to-scene', 'BrandingScene'); setShowNav(false); }}
                    >
                        Branding{!allCompanyDone && currentScene !== 'BrandingScene' ? ' (bloqueado)' : ''}
                    </button>
                    <button
                        className={`nav-map-item${!allBrandingDone && currentScene !== 'OfficeScene' ? ' nav-map-item--locked' : ''}${currentScene === 'OfficeScene' ? ' nav-map-item--active' : ''}`}
                        disabled={!allBrandingDone && currentScene !== 'OfficeScene'}
                        onClick={() => { EventBus.emit('navigate-to-scene', 'OfficeScene'); setShowNav(false); }}
                    >
                        Oficina{!allBrandingDone && currentScene !== 'OfficeScene' ? ' (bloqueado)' : ''}
                    </button>
                </div>
            )}

            <button
                className="badges-btn"
                onClick={() => { setShowBadges(!showBadges); setShowNav(false); setShowSettings(false); }}
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
                                    <span className="badge-icon">{'\uD83C\uDFC6'}</span>
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

            {taskDefs.length > 0 && (() => {
                const visible = taskDefs.filter(t => t.scene === currentScene && (!t.requires || t.requires.every(r => completedTasks.includes(r))));
                if (visible.length === 0) return null;
                return (
                    <div className="tasks-panel">
                        {visible.map(t => {
                            const done = completedTasks.includes(t.id);
                            return (
                                <div key={t.id} className={`task-item${done ? ' task-item--done' : ''}`}>
                                    <span className="task-check">{done ? '\u2713' : '\u25CB'}</span>
                                    <span>{t.name}</span>
                                </div>
                            );
                        })}
                    </div>
                );
            })()}

            {activeToast && (() => {
                const cfg = toastConfig[activeToast.type];
                return (
                    <div key={activeToast.key} className={cfg.className}>
                        <div>{cfg.icon}{cfg.icon && ' '}{activeToast.type === 'task-assigned' && activeToast.message === 'plural' ? 'Tienes nuevas tareas' : cfg.label}</div>
                        {activeToast.message && activeToast.message !== 'plural' && <div className="toast-detail">{activeToast.message}</div>}
                    </div>
                );
            })()}

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
