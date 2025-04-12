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

// Helper function to fetch and construct model URL from Supabase
async function getCharacterModelUrl(characterId: string): Promise<string | null> {
    console.log(`[FightPage] Fetching model URL for: ${characterId}`);
    try {
        const { data, error } = await supabase
            .from('characters')
            .select('model_glb_url')
            .eq('id', characterId)
            .single();

        if (error) {
            console.error(`[FightPage] Supabase error fetching model URL for ${characterId}:`, error);
            return null;
        }
        if (!data?.model_glb_url) {
            console.error(`[FightPage] No model_glb_url found for ${characterId}.`);
            return null;
        }

        let finalModelUrl = data.model_glb_url;
        // Construct absolute R2 URL if necessary
        if (!finalModelUrl.startsWith('http') && process.env.NEXT_PUBLIC_R2_PUBLIC_URL) {
            finalModelUrl = `${process.env.NEXT_PUBLIC_R2_PUBLIC_URL}/${finalModelUrl}`;
        }
         console.log(`[FightPage] Using model URL: ${finalModelUrl}`);
        return finalModelUrl;

    } catch (err) {
        console.error(`[FightPage] Unexpected error fetching model URL for ${characterId}:`, err);
        return null;
    }
}

// Default export for the page component
export default function FightPage() {
    const searchParams = useSearchParams();
    const charId1 = searchParams.get('char1');
    const charId2 = searchParams.get('char2');

    // State for fetched URLs, loading, and errors
    const [player1Url, setPlayer1Url] = useState<string | null>(null);
    const [player2Url, setPlayer2Url] = useState<string | null>(null);
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
        setPlayer1Url(null);
        setPlayer2Url(null);

        console.log(`[FightPage] Starting fetch for ${charId1} and ${charId2}`);
        Promise.all([getCharacterModelUrl(charId1), getCharacterModelUrl(charId2)])
            .then(([url1, url2]) => {
                console.log(`[FightPage] Fetched URLs: Player1=${url1}, Player2=${url2}`);
                if (url1 && url2) {
                    setPlayer1Url(url1);
                    setPlayer2Url(url2);
                } else {
                    let errorMsg = "Failed to fetch model URL(s).";
                    if (!url1) errorMsg += ` Could not find model for char1: ${charId1}.`;
                    if (!url2) errorMsg += ` Could not find model for char2: ${charId2}.`;
                    setError(errorMsg);
                }
            })
            .catch(err => {
                console.error("[FightPage] Error fetching character model URLs:", err);
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

    if (!player1Url || !player2Url) {
         // This state should ideally be covered by isLoading or error, but as a fallback
        return <LoadingFallback message="Preparing Scene..." />;
    }

    // --- Render the Scene --- 
    return (
        <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', background: '#000' }}> 
            <BattleScene 
                player1ModelUrl={player1Url}
                player2ModelUrl={player2Url}
            />
        </div>
    );
} 