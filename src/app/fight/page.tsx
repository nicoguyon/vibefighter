"use client";

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { BattleScene } from '@/components/BattleScene'; // Adjust import path if needed

// Import Supabase client (adjust path if needed)
import { supabase } from '@/lib/supabase/client'; 

async function getCharacterModelUrl(characterId: string): Promise<string | null> {
    console.log("[FightPage] Fetching model URL for:", characterId);
    try {
        const { data: characterData, error } = await supabase
            .from('characters')
            .select('model_glb_url') // Select only the URL field
            .eq('id', characterId)
            .single(); // Expect only one result

        if (error) {
            console.error(`[FightPage] Supabase error fetching model URL for ${characterId}:`, error);
            return null;
        }

        if (!characterData || !characterData.model_glb_url) {
            console.error(`[FightPage] No character data or model URL found for ${characterId}.`);
            return null;
        }

        let finalModelUrl = characterData.model_glb_url;

        // Prepend R2 public URL if the stored URL is relative (like in the editor example)
        if (finalModelUrl && !finalModelUrl.startsWith('http') && process.env.NEXT_PUBLIC_R2_PUBLIC_URL) {
            finalModelUrl = `${process.env.NEXT_PUBLIC_R2_PUBLIC_URL}/${finalModelUrl}`;
             console.log(`[FightPage] Constructed absolute URL: ${finalModelUrl}`);
        }
        
        if (!finalModelUrl) {
             console.error(`[FightPage] Final Model URL is still missing after potential construction for ${characterId}.`);
             return null;
        }

        console.log(`[FightPage] Successfully fetched model URL: ${finalModelUrl}`);
        return finalModelUrl;

    } catch (err) {
        console.error(`[FightPage] Unexpected error fetching model URL for ${characterId}:`, err);
        return null;
    }
}

function FightPageContent() {
    const searchParams = useSearchParams();
    const characterId = searchParams.get('charId');
    const [playerModelUrl, setPlayerModelUrl] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!characterId) {
            setError("Character ID is missing from URL.");
            setIsLoading(false);
            return;
        }

        // Fetch the URL using the implemented Supabase logic
        getCharacterModelUrl(characterId)
            .then(url => {
                if (url) {
                    setPlayerModelUrl(url);
                } else {
                     // Error message is more specific now
                     setError(`Failed to retrieve model URL for character ${characterId}. Check logs.`);
                }
            })
            .catch(err => {
                // This catch might be less likely now with try/catch in getCharacterModelUrl
                console.error("[FightPage] Error in promise chain for getCharacterModelUrl:", err);
                 setError("An unexpected error occurred while fetching the character model.");
            })
            .finally(() => {
                setIsLoading(false);
            });

    }, [characterId]);

    if (isLoading) {
        return <div>Loading Battle...</div>; // Or a more sophisticated loader
    }

    if (error) {
        return <div>Error: {error}</div>;
    }

    if (!playerModelUrl) {
         return <div>Error: Could not load character model URL.</div>; // Should be caught by error state, but safe fallback
    }

    return (
        <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
            <BattleScene playerModelUrl={playerModelUrl} />
        </div>
    );
}

// Wrap with Suspense because useSearchParams needs it
export default function FightPage() {
    return (
        <Suspense fallback={<div>Loading Character Info...</div>}>
            <FightPageContent />
        </Suspense>
    );
} 