"use client";

import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { playSoundEffect } from '@/utils/playSoundEffect';

const CONFIRM_SOUND_URL = '/sounds/effects/confirm.mp3';

export default function SelectCharacter() {
  const router = useRouter();

  const goToCreate = () => {
    playSoundEffect(CONFIRM_SOUND_URL);
    router.push('/create');
  };

  // Function to navigate to the new select existing page
  const goToSelectExisting = () => {
    playSoundEffect(CONFIRM_SOUND_URL);
    router.push('/select-existing');
  };

  // Placeholder for future function to select existing character
  // const goToExisting = (characterId: string) => {
  //   router.push(`/character/${characterId}`); 
  // };

  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-8 sm:p-12">
      <div className="w-full flex justify-center mt-4 mb-8">
        <Image 
          src="/images/vibefighter-logo.svg"
          alt="VibeFighter Logo - Small"
          width={300}
          height={150}
          priority={false}
        />
      </div>

      <div className="flex flex-col items-center text-center mb-auto">
        <h1 className="text-5xl sm:text-6xl font-bold mb-12 text-logo-yellow drop-shadow-[3px_3px_0_rgba(0,0,0,0.8)]">
          Character Select
        </h1>
        <div className="flex flex-col sm:flex-row gap-6 sm:gap-10">
          <button
            onClick={goToCreate}
            className="btn-arcade btn-arcade-primary w-72 sm:w-80 order-1 sm:order-none"
          >
            Create New Character
          </button>
          <button
            onClick={goToSelectExisting}
            className="btn-arcade btn-arcade-secondary w-72 sm:w-80 order-2 sm:order-none"
          >
            Select Existing Character
          </button>
        </div>
      </div>

      <footer className="w-full text-center p-4 text-sm text-arcade-gray">
         Vibefighter v0.1
      </footer>
    </main>
  );
} 