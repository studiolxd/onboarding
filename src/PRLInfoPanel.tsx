import { useEffect, useState } from 'react';
import { EventBus } from './game/EventBus';

interface RiskInfo {
    id: string;
    title: string;
    content: string[];
}

export function PRLInfoPanel() {
    const [info, setInfo] = useState<RiskInfo | null>(null);

    useEffect(() => {
        const onOpen = (data: RiskInfo) => setInfo(data);
        EventBus.on('prl-open-info', onOpen);
        return () => { EventBus.off('prl-open-info', onOpen); };
    }, []);

    if (!info) return null;

    return (
        <div className="computer-overlay">
            <div className="computer-header">
                <span className="computer-title">{info.title}</span>
                <button
                    className="computer-close"
                    onClick={() => {
                        const riskId = info.id;
                        setInfo(null);
                        EventBus.emit('prl-info-closed', riskId);
                    }}
                >
                    X Cerrar
                </button>
            </div>
            <div className="prl-info-content">
                {info.content.map((line, i) => (
                    <p key={i}>{line}</p>
                ))}
            </div>
        </div>
    );
}
