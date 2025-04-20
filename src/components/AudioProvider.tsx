"use client";

import React, { useState, useEffect, useRef, ReactNode, useCallback } from 'react';
import { AudioContext, MusicMode } from '../contexts/AudioContext';

interface AudioProviderProps {
  children: ReactNode;
}

// Type for the fetched playlists
interface Playlists {
    default: string[];
    fight: string[];
}

// Helper (keep this)
const getRandomTrackIndex = (playlist: string[], currentIndex: number | null): number => {
    if (playlist.length === 0) return -1; // Return -1 if empty
    if (playlist.length === 1) return 0;
    if (currentIndex === null || currentIndex === -1) return Math.floor(Math.random() * playlist.length);

    let nextIndex;
    do {
        nextIndex = Math.floor(Math.random() * playlist.length);
    } while (nextIndex === currentIndex);
    return nextIndex;
};

const MUSIC_VOLUME = 0.6; // Define desired volume level (60%)

export const AudioProvider: React.FC<AudioProviderProps> = ({ children }) => {
    const [playlists, setPlaylists] = useState<Playlists>({ default: [], fight: [] });
    const [isLoadingPlaylists, setIsLoadingPlaylists] = useState(true);
    const [playlistError, setPlaylistError] = useState<string | null>(null);

    const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(-1); // Start with invalid index
    const [isPlaying, setIsPlaying] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [hasInteracted, setHasInteracted] = useState(false);
    const [musicMode, setMusicMode] = useState<MusicMode>('default');
    const audioRef = useRef<HTMLAudioElement | null>(null);
    // No longer need currentPlaylistRef, will derive from state

    // Fetch playlists on mount
    useEffect(() => {
        const fetchPlaylists = async () => {
            setIsLoadingPlaylists(true);
            setPlaylistError(null);
            try {
                console.log("[AudioProvider] Fetching playlists from API...");
                const response = await fetch('/api/music-files');
                if (!response.ok) {
                    throw new Error(`API request failed with status ${response.status}`);
                }
                const data: Playlists = await response.json();
                 console.log("[AudioProvider] Playlists fetched:", data);
                 if (!data.default || !data.fight) {
                     throw new Error("Invalid playlist data format received from API");
                 }
                 // Basic validation: ensure arrays exist
                setPlaylists({
                    default: Array.isArray(data.default) ? data.default : [],
                    fight: Array.isArray(data.fight) ? data.fight : []
                });
            } catch (error: any) {
                console.error("[AudioProvider] Failed to fetch playlists:", error);
                setPlaylistError(error.message || "Unknown error fetching playlists");
                 // Keep empty playlists on error? Or set to null? Using empty arrays for now.
                 setPlaylists({ default: [], fight: [] });
            } finally {
                setIsLoadingPlaylists(false);
            }
        };

        fetchPlaylists();
    }, []);

    // Update track index when playlists load or mode changes
    useEffect(() => {
        if (!isLoadingPlaylists && playlistError === null) {
            const currentPlaylist = musicMode === 'fight' ? playlists.fight : playlists.default;
            console.log(`[AudioProvider] Playlists loaded or mode changed (${musicMode}). Selecting initial track.`);
            // Stop current playback before potentially changing index/playlist
            if (audioRef.current && !audioRef.current.paused) {
                 console.log("[AudioProvider] Pausing audio due to playlist load/mode change.");
                 audioRef.current.pause();
                 setIsPlaying(false);
             }
            setCurrentTrackIndex(getRandomTrackIndex(currentPlaylist, null)); // Get a new random index
        }
         // Handle error case? Maybe set index to -1 if playlists fail to load.
         else if (playlistError !== null) {
             setCurrentTrackIndex(-1);
         }

    }, [isLoadingPlaylists, playlistError, musicMode, playlists]); // Rerun when loading finishes, mode changes, or playlists potentially update (though playlists state itself shouldn't change after initial load without a refresh trigger)


    // Initialize Audio element, set volume, and setup ended listener
    useEffect(() => {
        audioRef.current = new Audio();
        audioRef.current.volume = MUSIC_VOLUME; // Set initial volume
        console.log(`[AudioProvider] Audio element created. Volume set to ${MUSIC_VOLUME}`);

        const handleTrackEnd = () => {
            if (isLoadingPlaylists || playlistError) return; // Don't process if playlists aren't ready

            const currentPlaylist = musicMode === 'fight' ? playlists.fight : playlists.default;
            console.log("[AudioProvider] Track ended, selecting next track for mode:", musicMode);
            setCurrentTrackIndex(prevIndex => getRandomTrackIndex(currentPlaylist, prevIndex));
        };

        audioRef.current.addEventListener('ended', handleTrackEnd);

        return () => {
            console.log("[AudioProvider] Unmounting. Cleaning up audio element.");
            audioRef.current?.removeEventListener('ended', handleTrackEnd);
            audioRef.current?.pause();
            audioRef.current = null;
        };
        // Run only once on mount
    }, [isLoadingPlaylists, playlistError, musicMode, playlists]); // Need dependencies that affect currentPlaylist inside handler

    // Effect to load and play the current track
    useEffect(() => {
        const currentPlaylist = musicMode === 'fight' ? playlists.fight : playlists.default;

        if (isLoadingPlaylists || playlistError || currentTrackIndex < 0 || currentTrackIndex >= currentPlaylist.length || !audioRef.current) {
             console.log(`[AudioProvider] Playback effect skipped (Loading: ${isLoadingPlaylists}, Error: ${playlistError}, Index: ${currentTrackIndex}, PlaylistLen: ${currentPlaylist.length}, AudioRef: ${!!audioRef.current})`);
              // Ensure audio is stopped if conditions aren't met
              if(audioRef.current && !audioRef.current.paused){
                   audioRef.current.pause();
                   setIsPlaying(false);
              }
             return;
        }

        // Ensure volume is set correctly before playing or changing src
        audioRef.current.volume = MUSIC_VOLUME; 

        const newSrc = currentPlaylist[currentTrackIndex];
        const currentFullSrc = audioRef.current.src;
        const newFullSrc = new URL(newSrc, window.location.origin).href;

        console.log(`[AudioProvider] Playback effect running. Mode: ${musicMode}, Index: ${currentTrackIndex}, Src: ${newSrc}, Interacted: ${hasInteracted}, Muted: ${isMuted}`);

        let needsSrcUpdate = false;
        if (currentFullSrc !== newFullSrc) {
            console.log(`[AudioProvider] Src mismatch. Updating src.`);
            if (!audioRef.current.paused) {
                audioRef.current.pause();
                setIsPlaying(false);
            }
            audioRef.current.src = newSrc;
            needsSrcUpdate = true;
        }

        // --- Playback Logic --- //
        if (hasInteracted && !isMuted) {
            if (needsSrcUpdate || audioRef.current.paused) {
                console.log("[AudioProvider] Attempting playback (Interacted & Unmuted).");
                 if (audioRef.current.currentSrc || audioRef.current.src) {
                    const playPromise = audioRef.current.play();
                    if (playPromise !== undefined) {
                        playPromise.then(() => {
                            console.log("[AudioProvider] Playback started/resumed.");
                            setIsPlaying(true);
                        }).catch(error => {
                            if (error.name !== 'AbortError') {
                                console.error(`[AudioProvider] Playback error:`, error);
                                setIsPlaying(false);
                            } else {
                                console.log("[AudioProvider] Playback promise aborted.");
                            }
                        });
                    }
                 } else {
                    console.warn("[AudioProvider] Playback skipped: src not loaded.");
                 }
            } else {
                if (!isPlaying) setIsPlaying(true);
                 console.log("[AudioProvider] Already playing.");
            }
        } else {
            if (!audioRef.current.paused) {
                console.log("[AudioProvider] Pausing playback (Muted or Not Interacted).");
                audioRef.current.pause();
                setIsPlaying(false);
            } else {
                 if (isPlaying) setIsPlaying(false);
                 console.log("[AudioProvider] Already paused.");
            }
        }
    }, [currentTrackIndex, hasInteracted, isMuted, musicMode, playlists, isLoadingPlaylists, playlistError]); // dependencies


    // --- Context Provided Functions ---
    const startPlayback = useCallback(() => {
        if (!hasInteracted) {
            console.log("[AudioProvider] Interaction detected.");
            setHasInteracted(true);
        }
    }, [hasInteracted]);

    const toggleMute = useCallback(() => {
         console.log(`[AudioProvider] Toggling mute.`);
         setIsMuted(prev => !prev);
    }, []);

    const setMode = useCallback((mode: MusicMode) => {
        console.log(`[AudioProvider] Setting music mode: ${mode}`);
        setMusicMode(mode);
    }, []);


    const currentTrack = !isLoadingPlaylists && playlistError === null && currentTrackIndex >= 0
        ? (musicMode === 'fight' ? playlists.fight : playlists.default)[currentTrackIndex]
        : null;

    // Maybe provide loading/error state via context if needed by consumers?
    const contextValue = {
        isPlaying,
        isMuted,
        toggleMute,
        startPlayback,
        currentTrack,
        setMusicMode: setMode,
        isLoadingPlaylists, // Expose loading state
        playlistError      // Expose error state
    };

    return (
        <AudioContext.Provider value={contextValue}>
            {children}
        </AudioContext.Provider>
    );
}; 