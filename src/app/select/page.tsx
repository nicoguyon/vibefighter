"use client";

import { useRouter } from 'next/navigation';
import Image from 'next/image';

export default function SelectCharacter() {
  const router = useRouter();

  const goToCreate = () => {
    router.push('/create');
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
            disabled
            className="btn-arcade-disabled w-72 sm:w-80 order-2 sm:order-none"
          >
            Use Existing Character
            <span className="block text-xs">(Coming Soon)</span>
          </button>
        </div>
      </div>

      <footer className="w-full text-center p-4 text-sm text-arcade-gray">
         Vibefighter v0.1
      </footer>
    </main>
  );
} 