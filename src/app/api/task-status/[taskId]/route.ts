import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// --- Environment Variable Checks ---
if (!process.env.TRIPO_API_KEY) throw new Error("Missing TRIPO_API_KEY");
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
if (!process.env.CLOUDFLARE_ACCOUNT_ID) throw new Error("Missing CLOUDFLARE_ACCOUNT_ID");
if (!process.env.R2_ACCESS_KEY_ID) throw new Error("Missing R2_ACCESS_KEY_ID");
if (!process.env.R2_SECRET_ACCESS_KEY) throw new Error("Missing R2_SECRET_ACCESS_KEY");
if (!process.env.R2_BUCKET_NAME) throw new Error("Missing R2_BUCKET_NAME");

const TRIPO_API_KEY = process.env.TRIPO_API_KEY;
const R2_BUCKET = process.env.R2_BUCKET_NAME;
const R2_ENDPOINT = `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

// --- Supabase Service Client ---
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
);

// --- Configure S3 Client for R2 ---
const S3 = new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

interface RouteParams {
    params: {
        taskId: string;
    }
}

// Fetches, uploads to R2, and updates Supabase
async function saveFinalModel(characterId: string, tripoModelUrl: string) {
    try {
        console.log(`[${characterId}] Fetching final model from Tripo: ${tripoModelUrl}`);
        const modelResponse = await fetch(tripoModelUrl);
        if (!modelResponse.ok) {
            throw new Error(`Failed to fetch final model from Tripo: ${modelResponse.statusText}`);
        }
        const modelContentType = modelResponse.headers.get('content-type') || 'model/gltf-binary';
        const modelBuffer = Buffer.from(await modelResponse.arrayBuffer());

        // Upload final model to R2
        const r2Key = `characters/${characterId}/model.glb`; // Fixed filename
        console.log(`[${characterId}] Uploading final model to R2: ${R2_BUCKET}/${r2Key}`);
        await S3.send(new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: r2Key,
            Body: modelBuffer,
            ContentType: modelContentType,
        }));
        const finalR2Url = R2_PUBLIC_URL ? `${R2_PUBLIC_URL}/${r2Key}` : ``;
        console.log(`[${characterId}] Final model uploaded to R2: ${finalR2Url || r2Key}`);

        // Update Supabase record
        console.log(`[${characterId}] Updating Supabase record with final model URL and status.`);
        const { error: updateError } = await supabaseAdmin
            .from('characters')
            .update({ 
                model_glb_url: finalR2Url || r2Key, // Store URL or key
                status: 'complete' 
            })
            .eq('id', characterId);

        if (updateError) {
            console.error(`[${characterId}] Supabase final update error:`, updateError);
            // Log error, but the model is saved in R2.
            // Maybe implement a retry mechanism or flag for manual check later.
        }
        console.log(`[${characterId}] Character marked as complete in Supabase.`);

    } catch(error) {
         console.error(`[${characterId}] Error saving final model:`, error);
         // Update status to failed if saving fails
         await supabaseAdmin.from('characters').update({ status: 'failed' }).eq('id', characterId);
    }
}

// GET function to handle /api/task-status/[taskId]
export async function GET(request: NextRequest, context: RouteParams) {
    // Destructure taskId from context.params
    const { taskId } = context.params; 

    if (!taskId) {
        return NextResponse.json({ error: 'Missing task ID' }, { status: 400 });
    }

    const url = `https://api.tripo3d.ai/v2/openapi/task/${taskId}`;
    console.log(`Polling Tripo task status: ${url}`);

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${TRIPO_API_KEY}`
            },
            // Add cache: 'no-store' to prevent Next.js caching API route responses
            cache: 'no-store' 
        });

        if (!response.ok) {
            // Handle cases where task might not be found (404) or other errors
            const errorText = await response.text();
            console.error(`Error fetching Tripo task status ${taskId}: ${response.status} ${response.statusText} - ${errorText}`);
            // Return a specific status if not found, otherwise generic error
            const errorMessage = response.status === 404 
                ? `Task ${taskId} not found.` 
                : `Failed to fetch task status: ${response.statusText}`;
            return NextResponse.json({ error: errorMessage, status_code: response.status }, { status: response.status });
        }

        const data = await response.json();
        console.log(`Task ${taskId} Status Data:`, data);

        // Check if the response structure is valid
        if (data.code !== 0 || !data.data) {
            console.error("Invalid status response from Tripo:", data);
            throw new Error("Received invalid status data from Tripo3D.");
        }

        // --- Check for Rigging Task Success & Save Final Model --- 
        // We need the character ID to save the model correctly.
        // We assume the client polls *rigging* tasks, and we fetch the char ID based on that.
        if (data.data.status === 'success' && data.data.type === 'animate_rig') {
             // Find the character associated with this RIGGING task ID
            console.log(`Rigging task ${taskId} successful. Finding character...`);
            const { data: charData, error: charError } = await supabaseAdmin
                .from('characters')
                .select('id, status') // Select status to avoid re-processing
                .eq('tripo_rig_task_id', taskId)
                .single();
            
            if (charError || !charData) {
                 console.error(`Character not found for rig task ${taskId}:`, charError);
                 // Don't throw, just log. The task is done, but we can't link it.
            } else if (charData.status !== 'complete') { // Check if already processed
                 console.log(`Found character ${charData.id} for rig task ${taskId}. Processing final model...`);
                 
                 // ***** CORRECTED PATH TO EXTRACT URL *****
                 const finalModelUrl = data.data.output?.model; 
                 
                 if (finalModelUrl && typeof finalModelUrl === 'string') {
                    // Call the function to save the model (don't await, let it run in background)
                    saveFinalModel(charData.id, finalModelUrl); 
                 } else {
                    console.error(`Final model URL not found at data.data.output.model in successful rig task ${taskId} output:`, data.data.output);
                     await supabaseAdmin.from('characters').update({ status: 'failed' }).eq('id', charData.id); // Mark as failed if URL missing
                 }
            } else {
                 console.log(`Character ${charData.id} already marked complete. Skipping final save.`);
            }
        }
        // --- End Final Model Saving Logic ---

        // Return the relevant data part
        return NextResponse.json(data.data, { status: 200 });

    } catch (error: any) {
        console.error(`Error polling task ${taskId}:`, error);
        return NextResponse.json({ error: error.message || 'Failed to get task status' }, { status: 500 });
    }
} 