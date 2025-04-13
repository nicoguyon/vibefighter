"use client";

import React, { Suspense, useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';

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

// Helper function to fetch and construct model URL AND name from Supabase
async function getCharacterData(characterId: string): Promise<{ name: string; modelUrl: string | null } | null> {
    console.log(`[FightPage] Fetching data for: ${characterId}`);
    try {
        const { data, error } = await supabase
            .from('characters')
            .select('name, model_glb_url') // Select name as well
            .eq('id', characterId)
            .single();

        if (error) {
            console.error(`[FightPage] Supabase error fetching data for ${characterId}:`, error);
            return null;
        }
        if (!data?.model_glb_url || !data?.name) {
            console.error(`[FightPage] Missing name or model_glb_url for ${characterId}.`);
            return null;
        }

        let finalModelUrl = data.model_glb_url;
        // Construct absolute R2 URL if necessary
        if (!finalModelUrl.startsWith('http') && process.env.NEXT_PUBLIC_R2_PUBLIC_URL) {
            finalModelUrl = `${process.env.NEXT_PUBLIC_R2_PUBLIC_URL}/${finalModelUrl}`;
        }
         console.log(`[FightPage] Using model URL: ${finalModelUrl} for Name: ${data.name}`);
        return { name: data.name, modelUrl: finalModelUrl }; // Return object

    } catch (err) {
        console.error(`[FightPage] Unexpected error fetching data for ${characterId}:`, err);
        return null;
    }
}

// Default export for the page component
export default function FightPage() {
    const searchParams = useSearchParams();
    const charId1 = searchParams.get('char1');
    const charId2 = searchParams.get('char2');

    // State for fetched URLs, names, loading, and errors
    const [player1Data, setPlayer1Data] = useState<{ name: string; modelUrl: string | null } | null>(null);
    const [player2Data, setPlayer2Data] = useState<{ name: string; modelUrl: string | null } | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!charId1 || !charId2) {
            setError("Missing character selection in URL (expected ?char1=...&char2=...). ");
            setIsLoading(false);
            return;
        }

        // Reset state for potential re-fetches if params change
        setIsLoading(true);
        setError(null);
        setPlayer1Data(null); // Reset data objects
        setPlayer2Data(null);

        console.log(`[FightPage] Starting fetch for ${charId1} and ${charId2}`);
        Promise.all([getCharacterData(charId1), getCharacterData(charId2)]) // Use updated function
            .then(([data1, data2]) => {
                console.log(`[FightPage] Fetched Data: Player1=${JSON.stringify(data1)}, Player2=${JSON.stringify(data2)}`);
                if (data1?.modelUrl && data2?.modelUrl) {
                    setPlayer1Data(data1); // Set the whole data object
                    setPlayer2Data(data2);
                } else {
                    let errorMsg = "Failed to fetch character data.";
                    if (!data1?.modelUrl || !data1?.name) errorMsg += ` Could not find model/name for char1: ${charId1}.`;
                    if (!data2?.modelUrl || !data2?.name) errorMsg += ` Could not find model/name for char2: ${charId2}.`;
                    setError(errorMsg);
                }
            })
            .catch(err => {
                console.error("[FightPage] Error fetching character data:", err);
                setError("An unexpected error occurred while fetching character data.");
            })
            .finally(() => {
                 console.log("[FightPage] Fetch completed.");
                setIsLoading(false);
            });

    // Re-run effect if search parameters change
    }, [charId1, charId2]);

    // --- Render based on state ---
    if (isLoading) {
        return <LoadingFallback message="Loading Character Models..." />;
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

    // Check data objects and their modelUrl properties
    if (!player1Data?.modelUrl || !player2Data?.modelUrl) {
         // This state should ideally be covered by isLoading or error, but as a fallback
        return <LoadingFallback message="Preparing Scene..." />;
    }

    // --- Render the Scene ---
    return (
        <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', background: '#000', position: 'relative' /* Needed for absolute positioning of health bars */ }}>
            {/* Pass names and URLs */}
            <BattleScene
                player1ModelUrl={player1Data.modelUrl}
                player2ModelUrl={player2Data.modelUrl}
                player1Name={player1Data.name}
                player2Name={player2Data.name}
            />
            {/* Health bars will be rendered inside BattleScene's parent div */}
        </div>
    );
} 