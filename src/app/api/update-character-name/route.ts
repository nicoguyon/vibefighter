import { supabaseAdmin } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// --- Environment Variable Checks ---
// Add checks needed for R2/TTS
if (!process.env.CLOUDFLARE_ACCOUNT_ID) throw new Error("Missing CLOUDFLARE_ACCOUNT_ID");
if (!process.env.R2_ACCESS_KEY_ID) throw new Error("Missing R2_ACCESS_KEY_ID");
if (!process.env.R2_SECRET_ACCESS_KEY) throw new Error("Missing R2_SECRET_ACCESS_KEY");
if (!process.env.R2_BUCKET_NAME) throw new Error("Missing R2_BUCKET_NAME");
if (!process.env.FISH_AUDIO_API_KEY) throw new Error("Missing FISH_AUDIO_API_KEY");

// --- R2/TTS Config ---
const R2_BUCKET = process.env.R2_BUCKET_NAME;
const R2_ENDPOINT = `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;
const FISH_AUDIO_API_KEY = process.env.FISH_AUDIO_API_KEY;

// --- Configure S3 Client for R2 ---
const S3 = new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

export async function POST(request: NextRequest) {
    let requestData;
    try {
        requestData = await request.json();
    } catch (error) {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { characterId, name } = requestData;
    const trimmedName = name?.trim(); // Trim name early

    if (!characterId || typeof characterId !== 'string') {
        return NextResponse.json({ error: 'Missing or invalid characterId' }, { status: 400 });
    }
    if (!trimmedName || typeof trimmedName !== 'string' || trimmedName.length === 0) {
        return NextResponse.json({ error: 'Missing or invalid name' }, { status: 400 });
    }

    console.log(`[API Update Name] Received request for ID: ${characterId}, Name: ${trimmedName}`);

    try {
        // Step 1: Update the name in Supabase
        const { data: updateResult, error: updateError } = await supabaseAdmin
            .from('characters')
            .update({ name: trimmedName })
            .eq('id', characterId)
            .select('id') // Select ID to confirm update
            .single();

        if (updateError) {
            console.error(`[API Update Name] Supabase error updating name for ${characterId}:`, updateError);
            if (updateError.code === 'PGRST116') {
                 return NextResponse.json({ error: `Character with ID ${characterId} not found.` }, { status: 404 });
            }
            return NextResponse.json({ error: updateError.message || 'Failed to update character name' }, { status: 500 });
        }
        
        if (!updateResult) {
             console.error(`[API Update Name] Character ${characterId} not found after update attempt (no data returned).`);
             return NextResponse.json({ error: `Character with ID ${characterId} not found.` }, { status: 404 });
        }

        console.log(`[API Update Name] Successfully updated name for character: ${updateResult.id}`);

        // Step 2: Generate TTS and update Supabase with audio URL (non-blocking for response)
        // Use try/catch for TTS part to avoid failing the whole request if TTS errors out
        try {
            console.log(`[API Update Name] Generating TTS for: ${trimmedName}`);
            
            const formData = new FormData();
            formData.append('text', `${trimmedName}.`);
            formData.append('reference_id', 'd13f84b987ad4f22b56d2b47f4eb838e'); // Keep reference ID

            const ttsResponse = await fetch('https://api.fish.audio/v1/tts?=', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${FISH_AUDIO_API_KEY}`,
                    'model': 'speech-1.5',
                },
                body: formData,
            });

            if (!ttsResponse.ok) {
                const errorText = await ttsResponse.text();
                throw new Error(`Fish Audio TTS API error: ${ttsResponse.statusText} - ${errorText}`);
            }

            const audioBuffer = Buffer.from(await ttsResponse.arrayBuffer());
            const audioContentType = ttsResponse.headers.get('content-type') || 'audio/mpeg';

            const audioR2Key = `characters/${characterId}/name_announcement.mp3`;
            console.log(`[API Update Name] Uploading name announcement to R2: ${R2_BUCKET}/${audioR2Key}`);
            await S3.send(new PutObjectCommand({
                Bucket: R2_BUCKET,
                Key: audioR2Key,
                Body: audioBuffer,
                ContentType: audioContentType,
            }));
            const finalAudioR2Url = R2_PUBLIC_URL ? `${R2_PUBLIC_URL}/${audioR2Key}` : audioR2Key; // Store full URL or key
            console.log(`[API Update Name] Name announcement uploaded to R2: ${finalAudioR2Url}`);

            const { error: audioUpdateError } = await supabaseAdmin
                .from('characters')
                .update({ name_audio_url: finalAudioR2Url })
                .eq('id', characterId);

            if (audioUpdateError) {
                console.error(`[API Update Name] Supabase audio URL update error for ${characterId}:`, audioUpdateError);
                // Log error, but don't fail the overall request
            } else {
                 console.log(`[API Update Name] Supabase updated with name announcement URL for ${characterId}.`);
            }

        } catch (ttsError) {
             console.error(`[API Update Name] Error during TTS generation/upload for ${characterId}:`, ttsError);
             // Log the error, but proceed to return success for the name update itself
        }
        
        // Return success for the name update, regardless of TTS outcome
        return NextResponse.json({ success: true, characterId: updateResult.id }, { status: 200 });

    } catch (error: any) {
        console.error(`[API Update Name] Unexpected error for ${characterId}:`, error);
        return NextResponse.json({ error: error.message || 'An unexpected error occurred' }, { status: 500 });
    }
} 