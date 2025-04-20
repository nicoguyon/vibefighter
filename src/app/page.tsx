"use client";

import { useEffect, useContext } from 'react';
import Image from "next/image";
import { useRouter } from 'next/navigation';
import { AudioContext } from '@/contexts/AudioContext';
import React from 'react';
import { playSoundEffect } from '@/utils/playSoundEffect';

const START_SOUND_URL = '/sounds/effects/start.mp3';

export default function Home() {
  const router = useRouter();
  const audioContext = useContext(AudioContext);

  if (!audioContext) {
    console.warn("Home Page: AudioContext not available yet.");
  }

  const startPlayback = audioContext ? audioContext.startPlayback : () => console.warn('startPlayback called before context ready');

  const handleInteraction = React.useCallback(() => {
    playSoundEffect(START_SOUND_URL);
    startPlayback();
    router.push('/select');
  }, [startPlayback, router]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        handleInteraction();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleInteraction]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
       <div className="text-center cursor-pointer group" onClick={handleInteraction}>
         <Image
           src="/images/vibefighter-logo.svg"
           alt="VibeFighter Logo"
           width={600}
           height={300}
           priority
           className="mb-12 mx-auto transition-transform duration-200 group-hover:scale-105"
         />
         <p className="text-3xl blink text-logo-yellow drop-shadow-[2px_2px_0_rgba(0,0,0,0.8)]">
           Press Enter Key
         </p>
         <p className="text-xl text-arcade-white mt-2">
             or Click to Start
         </p>
       </div>
     </main>
  );
}
