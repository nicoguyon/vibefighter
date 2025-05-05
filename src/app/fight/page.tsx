"use client";

import React, { Suspense, useState, useEffect, useContext } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { AudioContext } from '@/contexts/AudioContext';
import { playSoundEffect } from '@/utils/playSoundEffect';

// Dynamically import the BattleScene component with SSR disabled
const BattleScene = dynamic(
    () => import('@/components/BattleScene').then((mod) => mod.BattleScene),
    { ssr: false, loading: () => <LoadingFallback message="Loading Fight Scene..." /> }
);

// Simple loading component
function LoadingFallback({ message }: { message: string }) {
    return (
        <div className="flex items-center justify-center h-screen bg-gray-900 text-white">
            <p className="text-xl animate-pulse">{message}</p>
        </div>
    );
}

// --- Data Fetching Types ---
interface CharacterData {
    type: 'character';
    id: string;
    name: string;
    modelUrl: string | null;
    nameAudioUrl: string | null;
    specialImageUrl: string | null;
}

interface LocationData {
    type: 'location';
    id: string;
    backgroundImageUrl: string | null;
    floorTextureUrl: string | null;
}

type ResourceData = CharacterData | LocationData;

// Helper to ensure absolute URL
const ensureAbsoluteUrl = (url: string | null): string | null => {
    if (url && !url.startsWith('http') && process.env.NEXT_PUBLIC_R2_PUBLIC_URL) {
        return `${process.env.NEXT_PUBLIC_R2_PUBLIC_URL}/${url}`;
    }
    return url;
};

// Fetches either character or location data
async function getResourceData(id: string, resourceType: 'character' | 'location'): Promise<ResourceData | null> {
    console.log(`[FightPage] Fetching ${resourceType} data for: ${id}`);
    try {
        if (resourceType === 'character') {
            const { data, error } = await supabase
                .from('characters')
                .select('id, name, model_glb_url, name_audio_url, special_image')
                .eq('id', id)
                .single();

            if (error) throw error;
            if (!data?.model_glb_url || !data?.name) throw new Error("Missing name or model_glb_url");

            console.log(`[FightPage] Fetched Character: ${data.name} (ID: ${data.id}, Audio URL: ${!!data.name_audio_url}, Special Img: ${!!data.special_image})`);
            return {
                type: 'character',
                id: data.id,
                name: data.name,
                modelUrl: ensureAbsoluteUrl(data.model_glb_url),
                nameAudioUrl: ensureAbsoluteUrl(data.name_audio_url),
                specialImageUrl: ensureAbsoluteUrl(data.special_image)
            };
        } else if (resourceType === 'location') {
             const { data, error } = await supabase
                .from('locations')
                .select('background_image_url, floor_texture_url')
                .eq('id', id)
                .single();

            if (error) throw error;
            if (!data?.background_image_url || !data?.floor_texture_url) throw new Error("Missing background_image_url or floor_texture_url");
            
             console.log(`[FightPage] Fetched Location: ${id}`);
            return {
                type: 'location',
                id,
                backgroundImageUrl: ensureAbsoluteUrl(data.background_image_url),
                floorTextureUrl: ensureAbsoluteUrl(data.floor_texture_url)
            };
        }
        return null; // Should not happen

    } catch (err: any) {
        console.error(`[FightPage] Supabase error fetching ${resourceType} for ${id}:`, err);
        return null;
    }
}

// Default export for the page component
export default function FightPage() {
    const searchParams = useSearchParams();
    const router = useRouter();
    // Use original parameter names
    const charId1 = searchParams.get('char1');
    const charId2 = searchParams.get('char2');
    const locationId = searchParams.get('location'); // Add location ID

    // State for fetched data, loading, and errors
    const [player1Data, setPlayer1Data] = useState<CharacterData | null>(null);
    const [player2Data, setPlayer2Data] = useState<CharacterData | null>(null);
    const [locationData, setLocationData] = useState<LocationData | null>(null); // Add location state
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isSceneVisible, setIsSceneVisible] = useState(false); // New state for scene visibility

    // Get audio context
    const audioContext = useContext(AudioContext);

    // Callback to make the scene visible
    const handleSceneVisible = React.useCallback(() => {
        console.log("[FightPage] Scene is ready to be visible (INTRO_P1 starting).");
        setIsSceneVisible(true);
    }, []);

    // Effect to switch music mode on mount and unmount
    useEffect(() => {
        if (!audioContext) {
            console.warn("[FightPage] AudioContext not found.");
            return;
        }

        console.log("[FightPage] Mounting - Setting music mode to 'fight'");
        audioContext.setMusicMode('fight');

        // Cleanup function to run when component unmounts
        return () => {
            console.log("[FightPage] Unmounting - Setting music mode back to 'default'");
            // Check context again in cleanup in case it becomes undefined somehow (unlikely)
            audioContext?.setMusicMode('default');
        };
    }, [audioContext]); // Depend on audioContext to ensure it's available

    useEffect(() => {
        // Check all required IDs
        if (!charId1 || !charId2 || !locationId) {
            setError("Missing parameters in URL (expected ?char1=...&char2=...&location=...). ");
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        setError(null);
        setPlayer1Data(null);
        setPlayer2Data(null);
        setLocationData(null);

        console.log(`[FightPage] Starting fetch for Char1:${charId1}, Char2:${charId2}, Loc:${locationId}`);
        Promise.all([
            getResourceData(charId1, 'character'),
            getResourceData(charId2, 'character'),
            getResourceData(locationId, 'location') // Fetch location data
        ])
            .then(([p1Result, p2Result, locResult]) => {
                const p1 = p1Result as CharacterData | null;
                const p2 = p2Result as CharacterData | null;
                const loc = locResult as LocationData | null;
                
                console.log(`[FightPage] Fetched Data: P1=${p1?.name}, P2=${p2?.name}, Loc=${loc?.id}`);

                // Check all required data fields (including floor texture)
                if (p1?.id && p1?.modelUrl && p2?.modelUrl && loc?.backgroundImageUrl && loc?.floorTextureUrl) {
                    console.log("[FightPage] All required data fetched successfully.");
                    setPlayer1Data(p1);
                    setPlayer2Data(p2);
                    setLocationData(loc);
                    setError(null); // Clear error on success
                    setIsLoading(false); // Set loading false ONLY after successful data validation
                } else {
                    let errorMsg = "Failed to fetch required fight data.";
                    if (!p1?.id || !p1?.modelUrl || !p1?.name) errorMsg += ` Char1(${charId1}) missing data (id, model, or name).`;
                    if (!p2?.modelUrl || !p2?.name) errorMsg += ` Char2(${charId2}) missing data.`;
                    // Check floor texture URL in error message
                    if (!loc?.backgroundImageUrl || !loc?.floorTextureUrl) errorMsg += ` Loc(${locationId}) missing background or floor data.`;
                    console.error("[FightPage] Data validation failed:", errorMsg);
                    setError(errorMsg);
                    setIsLoading(false); // Set loading false after determining data is invalid
                }
            })
            .catch(err => {
                console.error("[FightPage] Error fetching resource data:", err);
                setError("An unexpected error occurred while fetching fight data.");
                setIsLoading(false); // Set loading false on fetch error
            });

    // Add locationId to dependency array
    }, [charId1, charId2, locationId]);

    // --- Render based on state ---
    if (isLoading) {
        return <LoadingFallback message="Loading Fight Data..." />;
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center h-screen bg-gray-900 text-white p-4">
                <h2 className="text-2xl text-red-500 mb-4">Error Loading Fight</h2>
                <p className="mb-6 text-center text-red-300">{error}</p>
                <Link href="/" className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white font-semibold">
                    Go back to Character Selection
                </Link>
            </div>
        );
    }

    // Check all required data objects and their properties (including floor texture and p1 ID)
    if (!player1Data?.id || !player1Data?.modelUrl || !player2Data?.modelUrl || !locationData?.backgroundImageUrl || !locationData?.floorTextureUrl) {
        // This case might not be strictly necessary anymore if isLoading handles the initial data fetch,
        // but can remain as a fallback check.
        return <LoadingFallback message="Validating Assets..." />;
    }

    // --- Log Props before rendering BattleScene ---
    console.log(`[FightPage] Rendering BattleScene with:
      P1 URL: ${player1Data?.modelUrl}
      P2 URL: ${player2Data?.modelUrl}
      BG URL: ${locationData?.backgroundImageUrl}
      Floor URL: ${locationData?.floorTextureUrl}`);

    // --- Render the Scene OR Loading Fallback ---
    return (
        <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', background: '#000', position: 'relative' }}>
            {!isSceneVisible && !isLoading && <LoadingFallback message="Preparing Scene..." />}
            <div style={{ visibility: isSceneVisible ? 'visible' : 'hidden', width: '100%', height: '100%' }}>
                {/* Pass names, URLs, and the new callback */}
                <BattleScene
                    player1Id={player1Data.id}
                    player1ModelUrl={player1Data.modelUrl}
                    player2ModelUrl={player2Data.modelUrl}
                    player1Name={player1Data.name}
                    player2Name={player2Data.name}
                    player1NameAudioUrl={player1Data.nameAudioUrl}
                    player2NameAudioUrl={player2Data.nameAudioUrl}
                    player1SpecialImageUrl={player1Data.specialImageUrl}
                    player2SpecialImageUrl={player2Data.specialImageUrl}
                    backgroundImageUrl={locationData.backgroundImageUrl}
                    floorTextureUrl={locationData.floorTextureUrl}
                    onSceneVisible={handleSceneVisible} // Pass the callback
                />
            </div>
            {/* Health bars will be rendered inside BattleScene's parent div, managed by BattleScene */}
        </div>
    );
} 