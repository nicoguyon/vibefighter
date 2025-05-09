"use client";

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation'; // Use useParams for client components
import Image from 'next/image';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { playSoundEffect } from '@/utils/playSoundEffect'; // Import the utility

interface Character {
    id: string;
    name: string;
    model_glb_url: string | null; // Keep for potential future use
    concept_image_url: string | null;
    name_audio_url: string | null;
    status: string | null; // Ensure we only pick 'complete' opponents
    special_image_url: string | null; // Added for special power
}

// --- NEW: Define Location Interface ---
interface Location {
    id: string;
    name: string | null; // Use the name column
    background_image_url: string | null; // Correct column name
    created_at: string;
}

// Helper to add R2 prefix if needed
const ensureAbsoluteUrl = (url: string | null): string | null => {
    if (url && !url.startsWith('http') && process.env.NEXT_PUBLIC_R2_PUBLIC_URL) {
        return `${process.env.NEXT_PUBLIC_R2_PUBLIC_URL}/${url}`;
    }
    return url;
};

const CONFIRM_SOUND_URL = '/sounds/effects/confirm.mp3'; // Define sound path

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

    // --- Location Modal State ---
    const [showLocationModal, setShowLocationModal] = useState(false);
    const [locationPrompt, setLocationPrompt] = useState("");
    const [isGeneratingLocation, setIsGeneratingLocation] = useState(false);
    const [generatedLocationUrl, setGeneratedLocationUrl] = useState<string | null>(null);
    const [locationGenerationError, setLocationGenerationError] = useState<string | null>(null);
    const [confirmedLocationId, setConfirmedLocationId] = useState<string | null>(null); // Used for both generated and selected

    // --- NEW State for Existing Locations ---
    const [existingLocations, setExistingLocations] = useState<Location[]>([]);
    const [isLoadingLocations, setIsLoadingLocations] = useState(false);
    const [locationFetchError, setLocationFetchError] = useState<string | null>(null);
    const [modalView, setModalView] = useState<'generate' | 'select'>('select'); // Default to 'select'
    const [selectedExistingLocation, setSelectedExistingLocation] = useState<Location | null>(null); // Track visual selection

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
                    .select('id, name, concept_image_url, name_audio_url, status, model_glb_url, special_image') // Fetch special_image
                    .eq('id', characterId)
                    .single();

                if (chosenError || !chosenData) {
                    throw new Error(chosenError?.message || 'Failed to load your fighter.');
                }
                 // Ensure image URL is absolute
                 const processedChosenCharacter: Character = {
                    ...chosenData,
                    concept_image_url: ensureAbsoluteUrl(chosenData.concept_image_url),
                    name_audio_url: ensureAbsoluteUrl(chosenData.name_audio_url),
                    special_image_url: ensureAbsoluteUrl(chosenData.special_image) // Process special_image and assign to correct field
                 };
                 setChosenCharacter(processedChosenCharacter);

                // Fetch all *other* potential opponents who are complete
                const { data: opponentData, error: opponentError } = await supabase
                    .from('characters')
                    .select('id, name, concept_image_url, name_audio_url, status, model_glb_url, special_image') // Fetch special_image
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
                       name_audio_url: ensureAbsoluteUrl(opp.name_audio_url),
                       special_image_url: ensureAbsoluteUrl(opp.special_image) // Process special_image
                   }));
                   setOpponents(processedOpponents as Character[]);
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

    // --- NEW: Function to Fetch Existing Locations ---
    const fetchExistingLocations = async () => {
        console.log("Fetching existing locations...");
        setIsLoadingLocations(true);
        setLocationFetchError(null);
        setExistingLocations([]); // Clear previous

        try {
            const { data, error } = await supabase
                .from('locations') // Assuming your table is named 'locations'
                .select('id, name, background_image_url, created_at') // Fetch correct image column
                .order('created_at', { ascending: false }) // Show newest first
                .limit(20); // Limit results for performance

            if (error) {
                throw new Error(error.message);
            }

            if (data) {
                const processedLocations = data.map(loc => ({
                    ...loc,
                    background_image_url: ensureAbsoluteUrl(loc.background_image_url) // Ensure URLs are absolute
                })).filter(loc => loc.background_image_url); // Filter based on correct column

                console.log(`Fetched ${processedLocations.length} existing locations.`);
                setExistingLocations(processedLocations as Location[]); // Cast needed if Supabase types aren't precise
            }
        } catch (err: any) {
            console.error("Error fetching existing locations:", err);
            setLocationFetchError(err.message || 'Failed to load existing locations.');
        } finally {
            setIsLoadingLocations(false);
        }
    };

     // 4. Handle Reroll
     const handleReroll = () => {
         playSoundEffect(CONFIRM_SOUND_URL); // Play sound
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
        playSoundEffect(CONFIRM_SOUND_URL); // Play sound
        setShowLocationModal(true);
        // Reset previous generation state when opening
        setGeneratedLocationUrl(null);
        setLocationGenerationError(null);
        setLocationPrompt("");
        setConfirmedLocationId(null); // Clear confirmation on open
        setSelectedExistingLocation(null); // Clear visual selection
        setModalView('select'); // Start in select view
        fetchExistingLocations(); // Fetch locations when modal opens
    };

    const handleCloseLocationModal = () => {
        setShowLocationModal(false);
        // Optionally reset state when closing completely
        // Don't reset generatedLocationUrl here, user might want to see it before confirming
        // setLocationPrompt("");
        // setGeneratedLocationUrl(null);
        // setLocationGenerationError(null);
    };

    const handleGenerateLocation = async () => {
        playSoundEffect(CONFIRM_SOUND_URL); // Play sound
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
            
            // Assuming the API returns { locationImageUrl: "...", locationId: "..." } 
            if (result.locationImageUrl && typeof result.locationImageUrl === 'string' && result.locationId && typeof result.locationId === 'string') {
                 console.log("Generated Location URL:", result.locationImageUrl);
                 console.log("Generated Location ID:", result.locationId);
                 setGeneratedLocationUrl(result.locationImageUrl);
                 setConfirmedLocationId(result.locationId); // Store the ID
                 // --- NEW: Optionally switch view and refresh locations ---
                 const newLocation: Location = {
                     id: result.locationId,
                     name: locationPrompt, // Use the prompt used for generation
                     background_image_url: result.locationImageUrl, // Map API response to correct field
                     created_at: new Date().toISOString() // Approximate creation time
                 };
                 setExistingLocations(prev => [newLocation, ...prev]); // Add to beginning of list
                 setSelectedExistingLocation(newLocation); // Auto-select the newly generated one
                 setModalView('select'); // Switch to select view to show it

            } else {
                console.error("API response missing or invalid locationImageUrl/locationId:", result);
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

    // --- NEW: Handle Selecting an Existing Location ---
    const handleSelectExistingLocation = (location: Location) => {
        playSoundEffect(CONFIRM_SOUND_URL); // Play sound
        console.log("Selected existing location:", location.id, location.name); // Use name
        setSelectedExistingLocation(location);
        setConfirmedLocationId(location.id);
        setGeneratedLocationUrl(location.background_image_url); // Use correct field
        setLocationGenerationError(null); // Clear any previous generation errors
    };

    const handleConfirmLocation = () => {
        playSoundEffect(CONFIRM_SOUND_URL); // Play sound
        // Ensure we have all IDs needed
        if (!confirmedLocationId) { // Check if an ID is confirmed (either generated or selected)
             // Maybe show an error message in the modal instead of alert
            setLocationGenerationError("Please generate or select a location first.");
            return;
        }
        if (!chosenCharacter?.id || !finalOpponent?.id) {
            console.error("Missing IDs for fight navigation:", { confirmedLocationId, chosenCharacterId: chosenCharacter?.id, finalOpponentId: finalOpponent?.id });
            // alert("Error: Cannot proceed to fight, missing required information.");
            setLocationGenerationError("Error: Cannot proceed, missing fighter information."); // Show error in modal
            return;
        }

        console.log("Location Confirmed ID:", confirmedLocationId);
        console.log(`Proceeding to fight: ${chosenCharacter.name} (${chosenCharacter.id}) vs ${finalOpponent.name} (${finalOpponent.id})`);
        
        // Construct the fight URL with query parameters
        const fightUrl = `/fight?char1=${encodeURIComponent(chosenCharacter.id)}&char2=${encodeURIComponent(finalOpponent.id)}&location=${encodeURIComponent(confirmedLocationId)}`;
        
        console.log("Navigating to:", fightUrl);
        // Navigate to the actual fight screen (ensure /fight page exists)
        router.push(fightUrl);
        // handleCloseLocationModal(); // Close modal automatically on navigation
        // handleCloseLocationModal(); // Close modal automatically? Maybe keep open until navigation occurs.
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
                {/* --- NEW: Chosen Character Special Power Image --- */}
                {chosenCharacter.special_image_url && (
                    <div className="mt-4 w-full max-w-xs h-20 relative">
                        <Image
                            src={chosenCharacter.special_image_url}
                            alt={`${chosenCharacter.name}'s special power`}
                            fill
                            style={{ objectFit: 'contain' }} // Use contain to show the whole image
                            sizes="(max-width: 768px) 25vw, 20vw"
                        />
                    </div>
                )}
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
                {/* --- NEW: Opponent Special Power Image --- */}
                {displayOpponent?.special_image_url && (
                    <div className="mt-4 w-full max-w-xs h-20 relative">
                        <Image
                            src={displayOpponent.special_image_url}
                            alt={`${displayOpponent.name}'s special power`}
                            fill
                            style={{ objectFit: 'contain' }} // Use contain to show the whole image
                            sizes="(max-width: 768px) 25vw, 20vw"
                            key={`${displayOpponent.id}-special`} // Add key for animation consistency if opponent changes
                        />
                    </div>
                )}
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
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4"> {/* Increased max-w, flex-col, max-h */}
                    <div className="relative bg-arcade-bg border-4 border-logo-yellow rounded-lg shadow-xl p-6 w-full max-w-3xl text-arcade-white flex flex-col max-h-[90vh]">

                        {/* Close Button */}
                        <button
                            onClick={handleCloseLocationModal}
                             className="absolute top-2 right-2 text-arcade-gray hover:text-arcade-white transition duration-150 p-1 bg-arcade-dark-gray rounded-full z-10" // Ensure button is above content
                            aria-label="Close location select"
                        >
                           <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>

                        <h2 className="text-3xl font-bold text-center mb-4 text-logo-yellow drop-shadow-[2px_2px_0_rgba(0,0,0,0.8)]">Select Fight Location</h2>

                        {/* --- Tabs for Generate/Select --- */}
                        <div className="flex justify-center border-b border-arcade-gray mb-4">
                            <button
                                onClick={() => setModalView('select')}
                                className={`px-4 py-2 text-lg font-medium transition-colors duration-200 ${modalView === 'select' ? 'text-logo-yellow border-b-2 border-logo-yellow' : 'text-arcade-gray hover:text-arcade-white'}`}
                            >
                                Select Existing
                            </button>
                            <button
                                onClick={() => {
                                    setModalView('generate');
                                    setSelectedExistingLocation(null);
                                    setConfirmedLocationId(null);
                                    setGeneratedLocationUrl(null); // Clear preview from selected
                                    setLocationGenerationError(null); // Clear potential selection errors
                                }}
                                className={`px-4 py-2 text-lg font-medium transition-colors duration-200 ${modalView === 'generate' ? 'text-logo-yellow border-b-2 border-logo-yellow' : 'text-arcade-gray hover:text-arcade-white'}`}
                            >
                                Generate New
                            </button>
                        </div>

                         {/* --- Content Area (Conditional) --- */}
                         <div className="flex-grow overflow-y-auto mb-4 pr-2"> {/* Allow content to scroll */}
                             {modalView === 'generate' && (
                                 <div>
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
                                            {isGeneratingLocation ? 'Generating...' : 'Generate Location Image'}
                                        </button>
                                    </div>
                                    {/* Generation Result Preview Area (Optional here or keep below?) */}
                                    {/* Maybe show a smaller preview here after generation */}
                                </div>
                             )}

                            {modalView === 'select' && (
                                <div>
                                    {isLoadingLocations && <p className="text-arcade-yellow text-center animate-pulse">Loading locations...</p>}
                                    {locationFetchError && <p className="text-red-500 text-center">Error: {locationFetchError}</p>}
                                    {!isLoadingLocations && existingLocations.length === 0 && !locationFetchError && (
                                        <p className="text-arcade-gray text-center py-8">No existing locations found. Try generating one!</p>
                                    )}
                                    {!isLoadingLocations && existingLocations.length > 0 && (
                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                                            {existingLocations.map((location) => (
                                                 <button
                                                    key={location.id}
                                                    onClick={() => handleSelectExistingLocation(location)}
                                                    className={`relative aspect-[16/7] rounded overflow-hidden border-4 transition-all duration-200 ${selectedExistingLocation?.id === location.id ? 'border-logo-yellow scale-105 shadow-lg' : 'border-transparent hover:border-arcade-yellow'}`}
                                                    disabled={isLoadingLocations} // Disable while loading potentially
                                                 >
                                                    {location.background_image_url ? (
                                                         <Image
                                                            src={location.background_image_url}
                                                            alt={location.name || 'Existing location'} // Use name for alt text
                                                            width={160} // Add explicit width
                                                            height={69} // Adjusted height for 21:9 ratio (160 * 9 / 21)
                                                            objectFit="cover" // Add objectFit prop
                                                            sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, 25vw"
                                                        />
                                                    ) : (
                                                        <div className="w-full h-full bg-arcade-dark-gray flex items-center justify-center text-arcade-gray">No Image</div>
                                                    )}
                                                    {/* Optional: Overlay prompt on hover? */}
                                                     {selectedExistingLocation?.id === location.id && (
                                                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                                             <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-logo-yellow" viewBox="0 0 20 20" fill="currentColor">
                                                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                            </svg>
                                                        </div>
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                         </div>

                        {/* --- Shared Preview and Confirm Area --- */}
                        <div className="flex-shrink-0 border-t border-arcade-gray pt-4">
                            <h3 className="text-xl font-semibold text-center mb-3 text-arcade-yellow">Preview</h3>
                             {/* Combined Results/Preview Area */}
                             <div className="min-h-[150px] flex flex-col items-center justify-center bg-arcade-dark-gray border border-arcade-gray rounded p-3 mb-4">
                                {isGeneratingLocation && modalView === 'generate' && ( // Show generating only if in generate view
                                    <p className="text-lg text-arcade-yellow animate-pulse">Creating your arena...</p>
                                )}
                                {locationGenerationError && ( // Show generation or selection errors
                                    <p className="text-base text-red-500 text-center">Error: {locationGenerationError}</p>
                                )}
                                {generatedLocationUrl && !isGeneratingLocation && ( // Show generated OR selected image
                                    <Image
                                        src={generatedLocationUrl}
                                        alt={selectedExistingLocation?.name || locationPrompt || "Selected Location"} // Use name or prompt
                                        width={350} // Slightly smaller preview
                                        height={150} // Adjusted height for 21:9 ratio (350 * 9 / 21)
                                        className="rounded border border-logo-yellow shadow-md max-w-full h-auto"
                                        objectFit="cover" // Ensure cover behavior
                                        priority // Load preview quickly
                                    />
                                )}
                                {!isGeneratingLocation && !locationGenerationError && !generatedLocationUrl && modalView === 'generate' && (
                                    <p className="text-arcade-gray text-center">Generate an image to preview it here.</p>
                                )}
                                 {!isGeneratingLocation && !locationGenerationError && !generatedLocationUrl && modalView === 'select' && !isLoadingLocations && (
                                    <p className="text-arcade-gray text-center">Select an existing location above to preview it.</p>
                                )}
                                 {!isGeneratingLocation && !locationGenerationError && !generatedLocationUrl && modalView === 'select' && isLoadingLocations && (
                                     <p className="text-arcade-gray text-center">Loading locations...</p>
                                )}
                            </div>

                            {/* Confirm Button */}
                             {(confirmedLocationId) && !isGeneratingLocation && ( // Show confirm only if an ID is set and not currently generating
                                <div className="text-center">
                                    <button
                                        onClick={handleConfirmLocation}
                                        className="btn-arcade btn-arcade-primary"
                                        disabled={!confirmedLocationId} // Extra safety check
                                    >
                                        Confirm Location & Fight!
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}
