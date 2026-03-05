import { useEffect, useState, useRef, useCallback } from 'react';
import { EventBus } from './game/EventBus';

const APPS: Record<string, { name: string; video: string; instructions: string[] }> = {
    nextcloud: {
        name: 'Nextcloud',
        video: 'assets/videos/nextcloud1.mp4',
        instructions: ['Introduce tus credenciales'],
    },
    frappe: {
        name: 'Frappe',
        video: 'assets/videos/frappe1.mp4',
        instructions: ['Introduce tus credenciales'],
    },
    fichar: {
        name: 'Registrar jornada',
        video: 'assets/videos/registrar_jornada.mp4',
        instructions: ['Registra tu entrada y salida'],
    },
    ausencia: {
        name: 'Solicitar ausencia',
        video: 'assets/videos/solicitar_ausencia.mp4',
        instructions: ['Solicita tus vacaciones o ausencias'],
    },
    turno: {
        name: 'Solicitar turno',
        video: 'assets/videos/solicitar_turno.mp4',
        instructions: ['Asigna tus dias de trabajo'],
    },
};

export function ComputerScreen() {
    const [appId, setAppId] = useState<string | null>(null);
    const [watchedVideos, setWatchedVideos] = useState<Set<string>>(new Set());
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const maxWatchedRef = useRef(0);
    const seekingRef = useRef(false);

    // Restore watched videos from saved state
    useEffect(() => {
        const onRestore = (ids: string[]) => setWatchedVideos(new Set(ids));
        EventBus.on('restore-watched-videos', onRestore);
        return () => { EventBus.off('restore-watched-videos', onRestore); };
    }, []);

    useEffect(() => {
        const onOpen = (id: string) => {
            setAppId(id);
            maxWatchedRef.current = 0;
        };
        const onClose = () => setAppId(null);

        EventBus.on('computer-open-app', onOpen);
        EventBus.on('computer-close', onClose);
        return () => {
            EventBus.off('computer-open-app', onOpen);
            EventBus.off('computer-close', onClose);
        };
    }, []);

    const handleTimeUpdate = useCallback(() => {
        const video = videoRef.current;
        if (!video || seekingRef.current) return;
        if (video.currentTime > maxWatchedRef.current) {
            maxWatchedRef.current = video.currentTime;
        }
    }, []);

    const handleSeeking = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        if (video.currentTime > maxWatchedRef.current + 0.5) {
            seekingRef.current = true;
            video.currentTime = maxWatchedRef.current;
            seekingRef.current = false;
        }
    }, []);

    const handleEnded = useCallback(() => {
        if (!appId) return;
        setWatchedVideos(prev => {
            if (prev.has(appId)) return prev;
            const next = new Set(prev);
            next.add(appId);
            EventBus.emit('video-watched', appId);
            return next;
        });
    }, [appId]);

    if (!appId || !APPS[appId]) return null;

    const app = APPS[appId];
    const alreadyWatched = watchedVideos.has(appId);
    const currentInstruction = app.instructions[0] ?? null;

    return (
        <div className="computer-overlay">
            <div className="computer-header">
                <span className="computer-title">{app.name}</span>
                <span className="computer-status">
                    {alreadyWatched ? 'Visto' : 'Sin ver'}
                </span>
                <button
                    className="computer-close"
                    onClick={() => {
                        setAppId(null);
                        EventBus.emit('computer-close');
                    }}
                >
                    X Cerrar
                </button>
            </div>
            <video
                ref={videoRef}
                className="computer-video"
                src={app.video}
                controls
                autoPlay
                onTimeUpdate={handleTimeUpdate}
                onSeeking={handleSeeking}
                onEnded={handleEnded}
            />
            {currentInstruction && (
                <div className="computer-instruction">
                    <span>{currentInstruction}</span>
                </div>
            )}
        </div>
    );
}
