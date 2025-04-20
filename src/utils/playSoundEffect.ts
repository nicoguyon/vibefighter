/**
 * Plays a one-off sound effect.
 * @param url - The path to the sound file (e.g., '/sounds/effects/start.mp3')
 * @param volume - Optional volume level (0.0 to 1.0), defaults to 1.0
 */
export const playSoundEffect = (url: string, volume: number = 1.0): void => {
    if (!url) {
        console.warn("[playSoundEffect] Attempted to play null or empty URL.");
        return;
    }
    try {
        const audio = new Audio(url);
        // Clamp volume just in case
        audio.volume = Math.max(0, Math.min(1, volume));
        audio.play().catch(error => {
            // Log errors specifically for sound effects
            console.error(`[playSoundEffect] Error playing ${url}:`, error);
        });
    } catch (error) {
        console.error(`[playSoundEffect] Error creating Audio object for ${url}:`, error);
    }
}; 