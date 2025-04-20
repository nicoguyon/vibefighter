import { createContext } from 'react';

export type MusicMode = 'default' | 'fight'; // Define and export the possible modes

export interface AudioContextType {
  isPlaying: boolean;
  isMuted: boolean;
  toggleMute: () => void;
  startPlayback: () => void; // Call this on first user interaction
  currentTrack: string | null;
  setMusicMode: (mode: MusicMode) => void; // Add function signature to set mode
}

// Provide a default context value that matches the type
const defaultContextValue: AudioContextType = {
    isPlaying: false,
    isMuted: false,
    toggleMute: () => console.warn('AudioContext: toggleMute called on default value'),
    startPlayback: () => console.warn('AudioContext: startPlayback called on default value'),
    currentTrack: null,
    setMusicMode: (mode: MusicMode) => console.warn(`AudioContext: setMusicMode(${mode}) called on default value`),
};

export const AudioContext = createContext<AudioContextType>(defaultContextValue); 