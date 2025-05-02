import { supabase } from '@/lib/supabase/client';
import { notFound } from 'next/navigation';
import CharacterViewer from './CharacterViewer';
import Link from 'next/link';
import Image from 'next/image';

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
        .select('id, name, model_glb_url, status, concept_image_url, name_audio_url, special_image')
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

    // Construct absolute R2 URL if necessary and not already absolute for model
    let finalModelUrl = characterData.model_glb_url;
    if (finalModelUrl && !finalModelUrl.startsWith('http') && process.env.NEXT_PUBLIC_R2_PUBLIC_URL) {
        finalModelUrl = `${process.env.NEXT_PUBLIC_R2_PUBLIC_URL}/${finalModelUrl}`;
    }

    // Construct absolute R2 URL for audio if necessary
    let finalAudioUrl = characterData.name_audio_url;
     if (finalAudioUrl && !finalAudioUrl.startsWith('http') && process.env.NEXT_PUBLIC_R2_PUBLIC_URL) {
        finalAudioUrl = `${process.env.NEXT_PUBLIC_R2_PUBLIC_URL}/${finalAudioUrl}`;
    }

    // Construct absolute R2 URL for special image if necessary
    let finalSpecialImageUrl = characterData.special_image;
     if (finalSpecialImageUrl && !finalSpecialImageUrl.startsWith('http') && process.env.NEXT_PUBLIC_R2_PUBLIC_URL) {
        finalSpecialImageUrl = `${process.env.NEXT_PUBLIC_R2_PUBLIC_URL}/${finalSpecialImageUrl}`;
    }

    // Handle cases where model isn't ready yet (audio URL doesn't block rendering here)
    if (characterData.status !== 'complete' || !finalModelUrl) {
        return (
             <main className="flex min-h-screen flex-col items-center justify-center p-8">
                <h1 className="text-4xl font-bold text-arcade-white mb-4">{characterData.name || 'Character'}</h1>
                <p className="text-2xl text-arcade-yellow animate-pulse">Model is still processing...</p>
                <p className="text-lg text-arcade-gray mt-2">(Status: {characterData.status || 'unknown'}) Please check back later.</p>
            </main>
        );
    }

    // If complete and URL exists, render the viewer and the image
    return (
        <main className="flex min-h-screen flex-col items-stretch justify-start p-0 relative"> 
            <div className="absolute top-4 left-4 z-10 bg-black/50 p-2 rounded">
                 <h1 className="text-2xl sm:text-3xl font-bold text-logo-yellow drop-shadow-[2px_2px_0_rgba(0,0,0,0.8)]">
                    {characterData.name || 'Unnamed Fighter'}
                </h1>
            </div>
           
            {finalSpecialImageUrl && (
                <div className="absolute top-4 right-4 z-10">
                     <Image
                        src={finalSpecialImageUrl}
                        alt={`${characterData.name || 'Character'} Special Power`}
                        width={0} 
                        height={80} 
                        style={{ 
                            objectFit: 'contain', 
                            width: 'auto', 
                            maxHeight: '120px' 
                        }} 
                        sizes="(max-width: 768px) 80px, 120px"
                    />
                </div>
            )}
           
            <CharacterViewer 
                modelUrl={finalModelUrl} 
                nameAudioUrl={finalAudioUrl}
            />

            {/* Navigation Buttons */}
            <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 z-10 flex flex-row justify-center gap-4 items-center">
                 <Link 
                    href={`/vs/${characterId}`} 
                    className="btn-arcade btn-arcade-primary px-8 py-3 text-lg"
                 >
                     Continue
                 </Link>
                <Link 
                    href="/select" 
                    className="btn-arcade btn-arcade-secondary px-6 py-3 text-lg"
                 >
                    Back to Menu
                 </Link>
            </div>

        </main>
    );
} 