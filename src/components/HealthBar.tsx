import React from 'react';

interface HealthBarProps {
    name: string;
    currentHealth: number;
    maxHealth: number;
    alignment: 'left' | 'right'; // To flip text alignment if needed
    style?: React.CSSProperties;
}

const HealthBar: React.FC<HealthBarProps> = ({
    name,
    currentHealth,
    maxHealth,
    alignment,
    style,
}) => {
    const healthPercentage = Math.max(0, (currentHealth / maxHealth) * 100);

    // Basic styling - apply external style prop here
    const barStyle: React.CSSProperties = {
        width: '45%', // <-- CHANGED: Make width almost half the screen
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        padding: '8px', // Slightly more padding
        borderRadius: '5px',
        border: '2px solid #444',
        boxShadow: '0 2px 5px rgba(0,0,0,0.5)',
        textAlign: alignment,
        ...style, // Spread the passed style prop
    };

    const nameStyle: React.CSSProperties = {
        color: 'white',
        fontSize: '16px', // Slightly larger
        fontWeight: 'bold',
        marginBottom: '4px', // More spacing
        textShadow: '1px 1px 2px black',
        fontFamily: "var(--font-pixel)", // <-- CHANGED: Use CSS variable for pixel font
    };

    const barContainerStyle: React.CSSProperties = {
        height: '20px', // Thicker bar
        backgroundColor: '#dc3545', // Red background behind green
        borderRadius: '3px',
        overflow: 'hidden',
        border: '1px solid #333',
    };

    const healthFillStyle: React.CSSProperties = {
        width: `${healthPercentage}%`,
        height: '100%',
        backgroundColor: '#28a745', // Vibrant green health
        transition: 'width 0.3s ease',
        borderRadius: '2px 0 0 2px',
    };

    return (
        <div style={barStyle}>
            <div style={nameStyle}>{name}</div>
            <div style={barContainerStyle}>
                <div style={healthFillStyle}></div>
            </div>
        </div>
    );
};

export default HealthBar; 