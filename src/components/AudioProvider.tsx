"use client";

import React, { useState, useEffect, useRef, ReactNode, useCallback } from 'react';
import { AudioContext } from '../contexts/AudioContext';

interface AudioProviderProps {
  children: ReactNode;
}

const musicFiles = [
  '/music/screens/Arcade Royale.mp3',
  '/music/screens/Final Battle Fever.mp3',
  '/music/screens/Fight the Night.mp3',
  '/music/screens/Pixel Dreams.mp3',
  '/music/screens/Pixel Hearts Beat Together.mp3',
  '/music/screens/Pixelated Battle Cry 2.mp3',
  '/music/screens/Pixelated Battle Cry.mp3',
  '/music/screens/Pixelated Battleground 2.mp3',
  '/music/screens/Pixelated Battleground.mp3',
  '/music/screens/Pixelated Fight Tonight.mp3',
  '/music/screens/Pixelated Glory.mp3',
];

export const AudioProvider: React.FC<AudioProviderProps> = ({ children }) => {
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    audioRef.current = new Audio();
    const initialIndex = Math.floor(Math.random() * musicFiles.length);
    setCurrentTrackIndex(initialIndex);

    const handleTrackEnd = () => {
      console.log("Track ended, selecting next track...");
      setCurrentTrackIndex(prevIndex => {
          if (prevIndex === null) return 0;
          let nextIndex;
          do {
            nextIndex = Math.floor(Math.random() * musicFiles.length);
          } while (nextIndex === prevIndex && musicFiles.length > 1);
          console.log("Next track index:", nextIndex);
          return nextIndex;
      });
    };

    audioRef.current.addEventListener('ended', handleTrackEnd);

    return () => {
      audioRef.current?.removeEventListener('ended', handleTrackEnd);
      audioRef.current?.pause();
      audioRef.current = null;
      console.log("AudioProvider unmounted, cleaning up.");
    };
  }, []);

  useEffect(() => {
    if (audioRef.current && currentTrackIndex !== null) {
      const newSrc = musicFiles[currentTrackIndex];
      console.log("Effect running: Loading track", currentTrackIndex, newSrc);

      if (audioRef.current.src !== window.location.origin + newSrc) {
         console.log("Setting new src:", newSrc);
         if (!audioRef.current.paused) {
             audioRef.current.pause();
         }
         audioRef.current.src = newSrc;
      }

      if (hasInteracted && !isMuted) {
          console.log("Effect condition: Auto-Play check (Interacted and not Muted)");
          if (audioRef.current.paused) {
              console.log("Effect action: Attempting auto-play/resume.");
              const playPromise = audioRef.current.play();
              if (playPromise !== undefined) {
                playPromise.then(() => {
                  console.log("Effect success: Auto-playback started/resumed for track:", currentTrackIndex);
                  setIsPlaying(true);
                }).catch(error => {
                  if (error.name !== 'AbortError') {
                     console.error(`Effect error: Auto-playback failed for track ${currentTrackIndex}:`, error);
                     setIsPlaying(false);
                  } else {
                     console.log("Effect info: Auto-play promise aborted (likely due to rapid change)");
                  }
                });
              }
          } else {
             console.log("Effect info: Already playing, ensuring state.");
             setIsPlaying(true);
          }
      } else {
          console.log("Effect condition: Not auto-playing (Muted or Not Interacted)");
          if (audioRef.current.paused) {
             setIsPlaying(false);
          }
      }
    }
  }, [currentTrackIndex, hasInteracted]);

  const startPlayback = useCallback(() => {
      if (!hasInteracted) {
        console.log("User interaction detected, setting hasInteracted=true");
        setHasInteracted(true);
      }
  }, [hasInteracted]);

  const toggleMute = () => {
      const becomingMuted = !isMuted;
      console.log(`Toggling mute state. Becoming ${becomingMuted ? 'Muted' : 'Unmuted'}`);
      setIsMuted(becomingMuted);

      if (audioRef.current) {
          if (becomingMuted) {
              if (!audioRef.current.paused) {
                  console.log("Muting: Pausing audio.");
                  audioRef.current.pause();
                  setIsPlaying(false);
              } else {
                 setIsPlaying(false);
              }
          } else {
              if (hasInteracted && audioRef.current.paused) {
                  console.log("Unmuting: Resuming audio.");
                  const playPromise = audioRef.current.play();
                   if (playPromise !== undefined) {
                      playPromise.then(() => {
                          console.log("Playback resumed by unmute.");
                          setIsPlaying(true);
                      }).catch(error => {
                          if (error.name !== 'AbortError') {
                             console.error("Error resuming playback on unmute:", error);
                             setIsPlaying(false);
                          }
                      });
                   }
              } else if (!hasInteracted) {
                  console.log("Unmuting: Not resuming yet (awaiting interaction).");
                  setIsPlaying(false);
              } else if (!audioRef.current.paused){
                   console.log("Unmuting: Was already playing (state should be correct).");
                   setIsPlaying(true);
              }
          }
      }
  };

  const currentTrack = currentTrackIndex !== null ? musicFiles[currentTrackIndex] : null;

  return (
    <AudioContext.Provider value={{ isPlaying, isMuted, toggleMute, startPlayback, currentTrack }}>
      {children}
    </AudioContext.Provider>
  );
}; 