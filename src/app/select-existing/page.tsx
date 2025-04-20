"use client";

import { supabase } from '@/lib/supabase/client';
import CharacterViewer from '../character/[characterId]/CharacterViewer'; // Adjust path if needed
import Link from 'next/link';
import Image from 'next/image';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation'; // Import useRouter
import { playSoundEffect } from '@/utils/playSoundEffect'; // Import the utility

const CONFIRM_SOUND_URL = '/sounds/effects/confirm.mp3'; // Define sound path

interface Character {
    id: string;
    name: string;
    model_glb_url: string | null;
    concept_image_url: string | null;
    name_audio_url: string | null;
    status: string | null;
}

export default function SelectExistingCharacter() {
    const [characters, setCharacters] = useState<Character[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);
    const router = useRouter(); // Initialize router

    useEffect(() => {
        async function fetchCharacters() {
            setLoading(true);
            setError(null);
            console.log("Fetching all characters...");

            // Ensure NEXT_PUBLIC_R2_PUBLIC_URL is read correctly client-side
            const r2PublicUrl = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;

            const { data, error: fetchError } = await supabase
                .from('characters')
                .select('id, name, model_glb_url, status, concept_image_url, name_audio_url')
                .order('created_at', { ascending: false }); // Or order by name, etc.

            if (fetchError) {
                console.error("Error fetching characters:", fetchError);
                setError("Failed to load characters. Please try again later.");
                setCharacters([]);
            } else if (data) {
                console.log(`Fetched ${data.length} characters.`);
                // Prepend R2 public URL if necessary
                const processedData = data.map(char => ({
                    ...char,
                    concept_image_url: char.concept_image_url && !char.concept_image_url.startsWith('http') && r2PublicUrl
                        ? `${r2PublicUrl}/${char.concept_image_url}`
                        : char.concept_image_url,
                    model_glb_url: char.model_glb_url && !char.model_glb_url.startsWith('http') && r2PublicUrl
                        ? `${r2PublicUrl}/${char.model_glb_url}`
                        : char.model_glb_url,
                    name_audio_url: char.name_audio_url && !char.name_audio_url.startsWith('http') && r2PublicUrl
                        ? `${r2PublicUrl}/${char.name_audio_url}`
                        : char.name_audio_url,
                }));
                setCharacters(processedData);
            } else {
                 setCharacters([]);
            }
            setLoading(false);
        }

        fetchCharacters();
    }, []);

    const handleSelectCharacter = (character: Character) => {
        // Play sound first, regardless of whether character is ready
        playSoundEffect(CONFIRM_SOUND_URL);
        
        if (character.status === 'complete' && character.model_glb_url) {
            setSelectedCharacter(character);
        } else {
            // Optionally show a message that the character isn't ready
            console.warn(`Character ${character.name} (${character.id}) is not ready for viewing (Status: ${character.status})`);
            alert(`${character.name} is still processing and cannot be viewed yet.`);
        }
    };

    const closeModal = () => {
        setSelectedCharacter(null);
    };

    // Handler to navigate to the VS screen
    const handleConfirmFighter = () => {
        playSoundEffect(CONFIRM_SOUND_URL); // Play sound
        if (selectedCharacter) {
            console.log(`Confirming fighter: ${selectedCharacter.name} (${selectedCharacter.id})`);
            const targetUrl = `/vs/${selectedCharacter.id}`;
            // Introduce a small delay before navigating
            setTimeout(() => {
                 console.log(`Navigating to VS screen: ${targetUrl}`);
                 router.push(targetUrl);
            }, 100); // 100ms delay - adjust if needed
        }
    };

    // Helper to determine if a character card should be disabled
    const isCharacterDisabled = (character: Character) => {
        return character.status !== 'complete' || !character.model_glb_url;
    };

    return (
        <main className="flex min-h-screen flex-col items-center p-8 bg-gradient-to-br from-arcade-dark-gray to-arcade-bg text-arcade-white">
            <Link href="/select" className="absolute top-4 left-4 z-20 text-arcade-yellow hover:text-logo-yellow transition duration-200">
                &larr; Back to Select
            </Link>

            <div className="w-full flex justify-center mt-4 mb-8">
                 <Image
                    src="/images/vibefighter-logo.svg"
                    alt="VibeFighter Logo - Small"
                    width={250}
                    height={125}
                    priority={false}
                />
            </div>

             <h1 className="text-5xl sm:text-6xl font-bold mb-12 text-logo-yellow drop-shadow-[3px_3px_0_rgba(0,0,0,0.8)]">
                Select Your Fighter
            </h1>

            {loading && <p className="text-xl text-arcade-yellow animate-pulse">Loading Fighters...</p>}
            {error && <p className="text-xl text-red-500">{error}</p>}

            {!loading && !error && characters.length === 0 && (
                <p className="text-xl text-arcade-gray">No characters found. <Link href="/create" className="text-arcade-yellow underline hover:text-logo-yellow">Create one?</Link></p>
            )}

            {!loading && !error && characters.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6 w-full max-w-6xl">
                    {characters.map((char) => (
                        <button
                            key={char.id}
                            onClick={() => handleSelectCharacter(char)}
                            disabled={isCharacterDisabled(char)}
                            className={`relative group aspect-square overflow-hidden rounded-md border-2 border-arcade-gray focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-arcade-bg focus:ring-logo-yellow transition duration-200 ease-in-out ${isCharacterDisabled(char) ? 'opacity-50 cursor-not-allowed' : 'hover:border-logo-yellow hover:scale-105 cursor-pointer'}`}
                        >
                            {char.concept_image_url ? (
                                <Image
                                    src={char.concept_image_url}
                                    alt={char.name || 'Character Concept'}
                                    fill // Use fill to cover the container
                                    style={{ objectFit: 'cover', objectPosition: 'top' }} // Cover and align top
                                    sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 20vw" // Responsive sizes
                                    priority={false} // Only prioritize above-the-fold images if needed
                                    className="transition duration-200 ease-in-out group-hover:brightness-110"
                                />
                            ) : (
                                <div className="w-full h-full bg-arcade-gray flex items-center justify-center text-sm text-center p-2">
                                    No Image
                                </div>
                            )}
                             {/* Overlay for Name */}
                             <div className={`absolute bottom-0 left-0 right-0 p-2 bg-black/60 backdrop-blur-sm transition duration-200 ease-in-out ${isCharacterDisabled(char) ? '' : 'group-hover:bg-black/80'}`}>
                                <p className="text-sm sm:text-base font-semibold text-center truncate text-arcade-white">
                                    {char.name || 'Unnamed'}
                                </p>
                                {isCharacterDisabled(char) && (
                                     <p className="text-xs text-center text-arcade-yellow">(Processing...)</p>
                                )}
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {/* Modal for Character Viewer */}
            {selectedCharacter && selectedCharacter.model_glb_url && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
                    <div className="relative max-w-4xl w-[80vw] max-h-[80vh] h-[80vh] bg-transparent rounded-lg overflow-hidden shadow-xl">
                         {/* Character Name Display */}
                         <div className="absolute top-4 left-4 z-10 bg-black/50 p-2 rounded">
                            <h1 className="text-xl sm:text-2xl font-bold text-logo-yellow drop-shadow-[2px_2px_0_rgba(0,0,0,0.8)]">
                                {selectedCharacter.name || 'Unnamed Fighter'}
                            </h1>
                        </div>
                        {/* Close Button - Adjusted Z-index slightly */}
                        <button
                            onClick={closeModal}
                            className="absolute top-2 right-2 z-20 bg-arcade-bg text-arcade-white rounded-full p-2 hover:bg-red-600 transition duration-200"
                            aria-label="Close character viewer"
                        >
                            {/* Simple X icon */}
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                        {/* Character Viewer takes up the container */}
                        <div className="w-full h-full">
                            <CharacterViewer
                                modelUrl={selectedCharacter.model_glb_url}
                                nameAudioUrl={selectedCharacter.name_audio_url ?? undefined}
                            />
                        </div>
                        {/* Choose Fighter Button Container */}
                        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-30">
                            <button
                                onClick={handleConfirmFighter}
                                className="btn-arcade btn-arcade-primary px-8 py-3 text-lg"
                            >
                                Choose Fighter
                            </button>
                        </div>
                    </div>
                </div>
            )}

             <footer className="w-full text-center p-4 mt-auto text-sm text-arcade-gray">
                Vibefighter v0.1
            </footer>
        </main>
    );
}
