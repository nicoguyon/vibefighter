import { supabase } from '@/lib/supabase/client';
import { notFound } from 'next/navigation';
import CharacterViewer from './CharacterViewer';

interface CharacterPageProps {
    params: {
        characterId: string;
    }
}

// Opt out of caching
export const dynamic = 'force-dynamic';

export default async function CharacterPage({ params }: CharacterPageProps) {
    const characterId = params.characterId; // Access ID directly

    console.log(`Fetching character data for ID: ${characterId}`);

    // Fetch character data directly inside the Server Component
    // Still using the client helper here - relies on RLS being configured correctly for reads.
    // For truly server-only access bypassing RLS, initialize a separate admin client here.
    const { data: characterData, error } = await supabase
        .from('characters')
        .select('id, name, model_glb_url, status, concept_image_url') // Select concept image too
        .eq('id', characterId)
        .single();

    if (error) {
        console.error(`Error fetching character ${characterId}:`, error);
        // Don't show Supabase error directly, trigger notFound
        notFound(); 
    }
    if (!characterData) {
         console.log(`Character ${characterId} not found in DB.`);
        notFound();
    }

    // Construct absolute R2 URL if necessary and not already absolute
    let finalModelUrl = characterData.model_glb_url;
    if (finalModelUrl && !finalModelUrl.startsWith('http') && process.env.NEXT_PUBLIC_R2_PUBLIC_URL) {
        finalModelUrl = `${process.env.NEXT_PUBLIC_R2_PUBLIC_URL}/${finalModelUrl}`;
    }

    // Handle cases where model isn't ready yet
    if (characterData.status !== 'complete' || !finalModelUrl) {
        return (
             <main className="flex min-h-screen flex-col items-center justify-center p-8">
                <h1 className="text-4xl font-bold text-arcade-white mb-4">{characterData.name || 'Character'}</h1>
                <p className="text-2xl text-arcade-yellow animate-pulse">Model is still processing...</p>
                <p className="text-lg text-arcade-gray mt-2">(Status: {characterData.status || 'unknown'}) Please check back later.</p>
            </main>
        );
    }

    // If complete and URL exists, render the viewer
    return (
        <main className="flex min-h-screen flex-col items-stretch justify-start p-0 relative"> 
            <div className="absolute top-4 left-4 z-10 bg-black/50 p-2 rounded">
                 <h1 className="text-2xl sm:text-3xl font-bold text-logo-yellow drop-shadow-[2px_2px_0_rgba(0,0,0,0.8)]">
                    {characterData.name || 'Unnamed Fighter'}
                </h1>
            </div>
           
            <CharacterViewer modelUrl={finalModelUrl} />

        </main>
    );
} 