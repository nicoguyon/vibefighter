"use client";

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation'; // Use useParams for client components
import Image from 'next/image';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';

interface Character {
    id: string;
    name: string;
    model_glb_url: string | null; // Keep for potential future use
    concept_image_url: string | null;
    name_audio_url: string | null;
    status: string | null; // Ensure we only pick 'complete' opponents
}

// Helper to add R2 prefix if needed
const ensureAbsoluteUrl = (url: string | null): string | null => {
    if (url && !url.startsWith('http') && process.env.NEXT_PUBLIC_R2_PUBLIC_URL) {
        return `${process.env.NEXT_PUBLIC_R2_PUBLIC_URL}/${url}`;
    }
    return url;
};

export default function VsPage() {
    const params = useParams();
    const router = useRouter();
    const characterId = params.characterId as string; // Get chosen character ID from URL

    const [chosenCharacter, setChosenCharacter] = useState<Character | null>(null);
    const [opponents, setOpponents] = useState<Character[]>([]);
    const [currentOpponent, setCurrentOpponent] = useState<Character | null>(null);
    const [finalOpponent, setFinalOpponent] = useState<Character | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isAnimating, setIsAnimating] = useState(false);

    // --- New State for Location Modal ---
    const [showLocationModal, setShowLocationModal] = useState(false);
    const [locationPrompt, setLocationPrompt] = useState("");
    const [isGeneratingLocation, setIsGeneratingLocation] = useState(false);
    const [generatedLocationUrl, setGeneratedLocationUrl] = useState<string | null>(null);
    const [locationGenerationError, setLocationGenerationError] = useState<string | null>(null);

    const animationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const opponentAudioRef = useRef<HTMLAudioElement | null>(null);

    // 1. Fetch Chosen Character and Potential Opponents
    useEffect(() => {
        if (!characterId) return;

        const fetchData = async () => {
            setIsLoading(true);
            setError(null);
            setChosenCharacter(null);
            setOpponents([]);
            setFinalOpponent(null);
            setCurrentOpponent(null);
            setIsAnimating(false);

            try {
                // Fetch chosen character
                const { data: chosenData, error: chosenError } = await supabase
                    .from('characters')
                    .select('id, name, concept_image_url, name_audio_url, status, model_glb_url')
                    .eq('id', characterId)
                    .single();

                if (chosenError || !chosenData) {
                    throw new Error(chosenError?.message || 'Failed to load your fighter.');
                }
                 // Ensure image URL is absolute
                 chosenData.concept_image_url = ensureAbsoluteUrl(chosenData.concept_image_url);
                 chosenData.name_audio_url = ensureAbsoluteUrl(chosenData.name_audio_url);
                 setChosenCharacter(chosenData);

                // Fetch all *other* potential opponents who are complete
                const { data: opponentData, error: opponentError } = await supabase
                    .from('characters')
                    .select('id, name, concept_image_url, name_audio_url, status, model_glb_url')
                    .neq('id', characterId) // Exclude the chosen character
                    .eq('status', 'complete') // Only select complete characters
                    .not('concept_image_url', 'is', null); // Must have an image

                if (opponentError) {
                    console.warn("Error fetching opponents, continuing without them:", opponentError);
                    setOpponents([]); // Proceed, but animation won't run
                } else if (opponentData) {
                    const processedOpponents = opponentData.map(opp => ({
                       ...opp,
                       concept_image_url: ensureAbsoluteUrl(opp.concept_image_url),
                       name_audio_url: ensureAbsoluteUrl(opp.name_audio_url)
                   }));
                   setOpponents(processedOpponents);
                }

            } catch (err: any) {
                console.error("VS Page fetch error:", err);
                setError(err.message || 'An error occurred.');
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();

        // Cleanup timeouts on unmount or id change
        return () => {
            if (animationTimeoutRef.current) {
                clearTimeout(animationTimeoutRef.current);
                animationTimeoutRef.current = null; // Clear ref too
            }
             if (opponentAudioRef.current) {
                opponentAudioRef.current.pause();
                opponentAudioRef.current = null;
            }
        };
    }, [characterId]);

    // 2. Start Animation when opponents are loaded
    useEffect(() => {
        if (isLoading || isAnimating || finalOpponent || opponents.length === 0) {
            return; // Don't start if loading, already animating, finished, or no opponents
        }

        console.log("Starting opponent selection animation...");
        setIsAnimating(true);

        let currentSpeed = 50; // Initial fast speed (ms)
        let cycles = 0;
        const totalFastCycles = opponents.length * 2 + Math.floor(Math.random() * opponents.length); // Cycle through everyone at least twice fast
        const slowDownStartCycle = totalFastCycles;
        const slowDownFactor = 1.3; // How much to slow down each step
        const maxSpeed = 700; // Maximum delay

        // Pre-determine the final opponent
        const finalIndex = Math.floor(Math.random() * opponents.length);
        let currentIndex = 0;

        const animate = () => {
            setCurrentOpponent(opponents[currentIndex % opponents.length]);
            cycles++;

            let nextSpeed = currentSpeed;
            // Slow down logic
            if (cycles >= slowDownStartCycle) {
                 nextSpeed = Math.min(currentSpeed * slowDownFactor, maxSpeed);
            }

            // Stop condition: After slowing down enough, land on the final index
            if (nextSpeed === maxSpeed && (currentIndex % opponents.length) === finalIndex) {
                console.log("Animation finished. Final opponent:", opponents[finalIndex].name);
                setFinalOpponent(opponents[finalIndex]);
                setIsAnimating(false);
                animationTimeoutRef.current = null;
                // Audio playback is handled in the next effect
            } else {
                 currentSpeed = nextSpeed;
                 currentIndex++;
                animationTimeoutRef.current = setTimeout(animate, currentSpeed);
            }
        };

        // Start the animation loop
        animationTimeoutRef.current = setTimeout(animate, currentSpeed);

    }, [isLoading, opponents, isAnimating, finalOpponent]); // Dependencies to trigger animation start

     // 3. Play Final Opponent Audio
     useEffect(() => {
         if (finalOpponent?.name_audio_url) {
             console.log(`Playing audio for: ${finalOpponent.name}`);
              if (opponentAudioRef.current) {
                 opponentAudioRef.current.pause(); // Stop previous audio if any
             }
             const audio = new Audio(finalOpponent.name_audio_url);
             opponentAudioRef.current = audio;
             audio.play().catch(err => console.error("Opponent audio playback failed:", err));
         }
     }, [finalOpponent]);

     // 4. Handle Reroll
     const handleReroll = () => {
         console.log("Rerolling opponent...");
        // Clear existing animation/audio
        if (animationTimeoutRef.current) {
            clearTimeout(animationTimeoutRef.current);
            animationTimeoutRef.current = null;
        }
        if (opponentAudioRef.current) {
            opponentAudioRef.current.pause();
            opponentAudioRef.current = null;
        }
        // Reset state to allow animation useEffect to re-trigger
        setFinalOpponent(null);
        setCurrentOpponent(null); // Reset displayed opponent immediately
        setIsAnimating(false); // Ensure animation can start
     };

    // --- Location Modal Handlers ---
    const handleOpenLocationModal = () => {
        setShowLocationModal(true);
        // Reset previous generation state when opening
        setGeneratedLocationUrl(null);
        setLocationGenerationError(null);
        setLocationPrompt(""); // Optionally clear prompt
    };

    const handleCloseLocationModal = () => {
        setShowLocationModal(false);
        // Optionally reset state when closing completely
        // setLocationPrompt("");
        // setGeneratedLocationUrl(null);
        // setLocationGenerationError(null);
    };

    const handleGenerateLocation = async () => {
        if (!locationPrompt.trim()) {
            setLocationGenerationError("Please enter a location description.");
            return;
        }
        setIsGeneratingLocation(true);
        setGeneratedLocationUrl(null);
        setLocationGenerationError(null);

        console.log(`Generating location for prompt: "${locationPrompt}"`);

        try {
            // --- API Call Placeholder --- 
            // Replace this with the actual fetch call to your new API endpoint
            const response = await fetch('/api/generate-location', { // Assuming this endpoint
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userPrompt: locationPrompt })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({})); // Catch potential JSON parse error
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            
            // Assuming the API returns { locationImageUrl: "..." } 
            if (result.locationImageUrl && typeof result.locationImageUrl === 'string') {
                 console.log("Generated Location URL:", result.locationImageUrl);
                 setGeneratedLocationUrl(result.locationImageUrl);
            } else {
                console.error("API response missing or invalid locationImageUrl:", result);
                throw new Error("Invalid response from location generation API.");
            }
           // --- End API Call Placeholder --- 
            
        } catch (error: any) {
            console.error("Location generation failed:", error);
            setLocationGenerationError(error.message || "Failed to generate location image.");
        } finally {
            setIsGeneratingLocation(false);
        }
    };

    const handleConfirmLocation = () => {
        if (!generatedLocationUrl || !chosenCharacter || !finalOpponent) return;

        console.log("Location Confirmed:", generatedLocationUrl);
        console.log(`Proceeding to fight: ${chosenCharacter.name} vs ${finalOpponent.name}`);
        alert("Fight screen not implemented yet!");
        // Example: Navigate to the actual fight screen (replace alert)
        // const fightUrl = `/fight/${chosenCharacter.id}/${finalOpponent.id}?location=${encodeURIComponent(generatedLocationUrl)}`;
        // router.push(fightUrl);
        handleCloseLocationModal(); // Close modal after confirmation
    };

    // --- Render Logic ---

    if (isLoading) {
        return (
            <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-gradient-to-br from-arcade-dark-gray to-arcade-bg text-arcade-white">
                <p className="text-2xl text-arcade-yellow animate-pulse">Preparing the arena...</p>
            </main>
        );
    }

    if (error) {
        return (
            <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-gradient-to-br from-arcade-dark-gray to-arcade-bg text-arcade-white">
                <p className="text-2xl text-red-500 mb-4">Error: {error}</p>
                <Link href="/select-existing" className="btn-arcade btn-arcade-secondary">
                    Back to Select
                </Link>
            </main>
        );
    }

     if (!chosenCharacter) {
         // Should ideally be caught by error state, but belt-and-suspenders
         return (
            <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-gradient-to-br from-arcade-dark-gray to-arcade-bg text-arcade-white">
                <p className="text-2xl text-red-500 mb-4">Could not load your fighter data.</p>
                <Link href="/select-existing" className="btn-arcade btn-arcade-secondary">
                    Back to Select
                </Link>
            </main>
        );
    }

    // Determine opponent to display (current animating or final)
    const displayOpponent = finalOpponent || currentOpponent;

    return (
        <main className="flex min-h-screen items-center justify-around p-8 bg-gradient-to-b from-blue-900 via-purple-900 to-black text-arcade-white overflow-hidden">
             {/* Back Button */}
            <Link href="/select-existing" className="absolute top-4 left-4 z-50 text-arcade-yellow hover:text-logo-yellow transition duration-200 opacity-80 hover:opacity-100">
                &larr; Change Fighter
            </Link>

            {/* Chosen Fighter (Left) */}
            <div className="flex flex-col items-center w-1/3">
                <div className="aspect-square w-full max-w-sm relative overflow-hidden rounded-lg border-4 border-blue-500 shadow-lg mb-4">
                     {chosenCharacter.concept_image_url ? (
                        <Image
                            src={chosenCharacter.concept_image_url}
                            alt={chosenCharacter.name}
                            fill
                            style={{ objectFit: 'cover', objectPosition: 'top' }}
                            sizes="(max-width: 768px) 33vw, 33vw"
                            priority // Prioritize loading the chosen fighter's image
                        />
                    ) : (
                         <div className="w-full h-full bg-arcade-gray flex items-center justify-center">No Image</div>
                    )}
                 </div>
                 <h2 className="text-4xl font-bold text-logo-yellow drop-shadow-[3px_3px_0_rgba(0,0,0,0.8)] uppercase tracking-wider">
                     {chosenCharacter.name}
                 </h2>
             </div>

            {/* VS Text */}
             <div className="text-7xl font-black text-red-600 drop-shadow-[4px_4px_0_rgba(255,255,255,0.7)] mx-4 animate-pulse">
                 VS
             </div>

             {/* Opponent (Right) */}
             <div className="relative flex flex-col items-center w-1/3">
                {/* Reroll Button - Moved here, positioned above image */}
                 {opponents.length > 1 && finalOpponent && (
                    <button
                        onClick={handleReroll}
                        className="absolute -top-12 left-1/2 transform -translate-x-1/2 z-20 btn-arcade btn-arcade-secondary px-4 py-1 text-sm"
                    >
                        Reroll
                    </button>
                 )}
                 {/* Opponent Image Container */}
                <div className={`aspect-square w-full max-w-sm relative overflow-hidden rounded-lg border-4 border-red-700 shadow-lg mb-4 transition-opacity duration-100 ${isAnimating ? 'opacity-90' : 'opacity-100'}`}>
                    {displayOpponent?.concept_image_url ? (
                        <Image
                            src={displayOpponent.concept_image_url}
                            alt={displayOpponent.name}
                            fill
                            style={{ objectFit: 'cover', objectPosition: 'top' }}
                            sizes="(max-width: 768px) 33vw, 33vw"
                            key={displayOpponent.id} // Force re-render on change for animation
                        />
                    ) : (
                         <div className="w-full h-full bg-arcade-gray flex items-center justify-center">
                             {opponents.length > 0 ? '?' : 'No Opponents'}
                         </div>
                    )}
                 </div>
                 <h2 className={`text-4xl font-bold text-logo-yellow drop-shadow-[3px_3px_0_rgba(0,0,0,0.8)] uppercase tracking-wider transition-opacity duration-100 ${isAnimating ? 'opacity-75' : 'opacity-100'}`}>
                     {displayOpponent?.name || '??????'}
                 </h2>
             </div>

             {/* Choose Location Button Container - Replaces Start Fight */}
             {finalOpponent && (
                 <div className="absolute bottom-10 left-1/2 transform -translate-x-1/2 z-50">
                     <button
                         onClick={handleOpenLocationModal} // Opens the modal
                         className="btn-arcade btn-arcade-primary animate-bounce"
                     >
                         Choose Location
                     </button>
                 </div>
             )}

            {/* --- Location Selection Modal --- */}
            {showLocationModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
                    <div className="relative bg-arcade-bg border-4 border-logo-yellow rounded-lg shadow-xl p-6 w-full max-w-xl text-arcade-white">
                        {/* Close Button */} 
                        <button 
                            onClick={handleCloseLocationModal}
                            className="absolute top-2 right-2 text-arcade-gray hover:text-arcade-white transition duration-150 p-1 bg-arcade-dark-gray rounded-full"
                            aria-label="Close location select"
                        >
                           <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>

                        <h2 className="text-3xl font-bold text-center mb-6 text-logo-yellow drop-shadow-[2px_2px_0_rgba(0,0,0,0.8)]">Select Location</h2>

                        {/* Prompt Input */} 
                        <div className="mb-4">
                             <label htmlFor="locationPrompt" className="block text-lg font-medium mb-2 text-arcade-yellow">Describe the location:</label>
                             <textarea 
                                id="locationPrompt"
                                rows={3}
                                className="w-full p-2 bg-arcade-dark-gray border border-arcade-gray rounded focus:ring-2 focus:ring-logo-yellow focus:border-logo-yellow outline-none resize-none placeholder-arcade-gray text-base"
                                placeholder="e.g., A mystical forest clearing at dawn, An ancient ruined temple on a mountaintop, A neon-lit cyberpunk city street at night..."
                                value={locationPrompt}
                                onChange={(e) => setLocationPrompt(e.target.value)}
                                disabled={isGeneratingLocation}
                            />
                        </div>

                        {/* Generate Button */} 
                        <div className="text-center mb-4">
                             <button
                                onClick={handleGenerateLocation}
                                disabled={isGeneratingLocation || !locationPrompt.trim()}
                                className={`btn-arcade btn-arcade-secondary w-full sm:w-auto ${isGeneratingLocation ? 'opacity-50 cursor-wait' : ''}`}
                            >
                                {isGeneratingLocation ? 'Generating...' : 'Generate Location'}
                            </button>
                        </div>

                        {/* Results Area */} 
                        <div className="min-h-[200px] flex flex-col items-center justify-center bg-arcade-dark-gray border border-arcade-gray rounded p-4 mb-6">
                            {isGeneratingLocation && (
                                 <p className="text-xl text-arcade-yellow animate-pulse">Creating your arena...</p>
                            )}
                            {locationGenerationError && (
                                 <p className="text-lg text-red-500 text-center">Error: {locationGenerationError}</p>
                            )}
                            {generatedLocationUrl && !isGeneratingLocation && (
                                 <Image 
                                    src={generatedLocationUrl}
                                    alt="Generated Location Background"
                                    width={400} // Adjust size as needed
                                    height={187} // Maintain 21:9 aspect ratio roughly (400 * 9 / 21)
                                    className="rounded border border-logo-yellow shadow-md"
                                    priority // Load the new image quickly
                                />
                            )}
                            {!isGeneratingLocation && !locationGenerationError && !generatedLocationUrl && (
                                <p className="text-arcade-gray text-center">Enter a description and click "Generate Location" to create the background.</p>
                            )}
                        </div>

                         {/* Confirm Button */} 
                         {generatedLocationUrl && !isGeneratingLocation && (
                             <div className="text-center">
                                <button
                                    onClick={handleConfirmLocation}
                                    className="btn-arcade btn-arcade-primary"
                                >
                                    Confirm Location & Fight!
                                </button>
                            </div>
                         )}
                    </div>
                </div>
            )}
        </main>
    );
}
