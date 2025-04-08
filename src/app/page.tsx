"use client";

import { useEffect } from 'react';
import Image from "next/image";
import { useRouter } from 'next/navigation'; // Import useRouter

export default function Home() {
  const router = useRouter(); // Initialize router

  // Function to navigate to character select
  const goToSelect = () => {
    router.push('/select');
  };

  // Effect to handle 'Enter' key press
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        goToSelect();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array, runs once

  return (
    // Adjusted main container for direct centering
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
       <div className="text-center cursor-pointer group" onClick={goToSelect}>
         <Image
           src="/vibefighter-logo.svg"
           alt="VibeFighter Logo"
           width={600}
           height={300}
           priority
           className="mb-12 mx-auto transition-transform duration-200 group-hover:scale-105" // Subtle hover effect
         />
         {/* Use logo colors for the text */}
         <p className="text-3xl blink text-logo-yellow drop-shadow-[2px_2px_0_rgba(0,0,0,0.8)]"> 
           Press Enter Key
         </p>
         <p className="text-xl text-arcade-white mt-2">
             or Click to Start
         </p>
       </div>
     </main>
    // Removed the outer div and footer from the original template structure
    // Keep the layout clean for the intro
  );
}
