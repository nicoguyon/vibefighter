"use client";

import React from 'react';
import { useAudio } from '../contexts/AudioContext';
import { Volume2, VolumeX } from 'lucide-react'; // Using lucide-react icons

export const MuteButton: React.FC = () => {
  const { isMuted, toggleMute } = useAudio();

  return (
    <button
      onClick={toggleMute}
      className="fixed bottom-4 right-4 p-2 bg-gray-800 text-white rounded-full shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-white transition-opacity hover:opacity-80"
      aria-label={isMuted ? 'Unmute' : 'Mute'}
    >
      {isMuted ? (
        <VolumeX size={24} />
      ) : (
        <Volume2 size={24} />
      )}
    </button>
  );
}; 