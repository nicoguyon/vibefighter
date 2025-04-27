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
        console.log(`[Char ${characterId}] Fetching final model from Tripo: ${tripoModelUrl}`);
        const modelResponse = await fetch(tripoModelUrl);
        if (!modelResponse.ok) {
            throw new Error(`Failed to fetch final model from Tripo: ${modelResponse.statusText}`);
        }
        const modelContentType = modelResponse.headers.get('content-type') || 'model/gltf-binary';
        const modelBuffer = Buffer.from(await modelResponse.arrayBuffer());

        // Upload final model to R2
        const r2Key = `characters/${characterId}/model.glb`; // Fixed filename
        console.log(`[Char ${characterId}] Uploading final model to R2: ${R2_BUCKET}/${r2Key}`);
        await S3.send(new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: r2Key,
            Body: modelBuffer,
            ContentType: modelContentType,
        }));
        const finalR2Url = R2_PUBLIC_URL ? `${R2_PUBLIC_URL}/${r2Key}` : ``;
        console.log(`[Char ${characterId}] Final model uploaded to R2: ${finalR2Url || r2Key}`);

        // Update Supabase record
        console.log(`[Char ${characterId}] Updating Supabase record with final model URL and status 'complete'.`);
        const { error: updateError } = await supabaseAdmin
            .from('characters')
            .update({ 
                model_glb_url: finalR2Url || r2Key, // Store URL or key
                status: 'complete' 
            })
            .eq('id', characterId);

        if (updateError) {
            console.error(`[Char ${characterId}] Supabase final update error:`, updateError);
            // Log error, but the model is saved in R2.
            // Maybe implement a retry mechanism or flag for manual check later.
            // Consider *not* setting status back to failed here, as the model exists.
            // Perhaps set a specific error state or leave as 'saving_model'?
        } else {
            console.log(`[Char ${characterId}] Character marked as complete in Supabase.`);
        }

    } catch(error) {
         console.error(`[Char ${characterId}] Error during saveFinalModel process:`, error);
         // Update status to failed if saving fails critically
         try {
             await supabaseAdmin.from('characters').update({ status: 'failed' }).eq('id', characterId);
             console.log(`[Char ${characterId}] Marked character as 'failed' in DB due to saveFinalModel error.`);
         } catch (dbError) {
             console.error(`[Char ${characterId}] Failed to mark character as 'failed' after saveFinalModel error:`, dbError);
         }
    }
}

// GET function to handle /api/task-status/[taskId]
export async function GET(request: NextRequest, context: RouteParams) {
    const { taskId } = context.params;

    if (!taskId) {
        return NextResponse.json({ error: 'Missing task ID' }, { status: 400 });
    }

    const url = `https://api.tripo3d.ai/v2/openapi/task/${taskId}`;
    console.log(`[Task ${taskId}] Polling Tripo task status: ${url}`);

    try {
        const tripoResponse = await fetch(url, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${TRIPO_API_KEY}`
            },
            cache: 'no-store'
        });

        if (!tripoResponse.ok) {
            const errorText = await tripoResponse.text();
            console.error(`[Task ${taskId}] Error fetching Tripo status: ${tripoResponse.status} ${tripoResponse.statusText} - ${errorText}`);
            const errorMessage = tripoResponse.status === 404
                ? `Task ${taskId} not found.`
                : `Failed to fetch task status: ${tripoResponse.statusText}`;
            // Try to find character and mark as failed if task is gone
            const { data: charDataForFail } = await supabaseAdmin
                .from('characters')
                .select('id, status')
                .or(`tripo_model_task_id.eq.${taskId},tripo_rig_task_id.eq.${taskId}`)
                .maybeSingle();
            if (charDataForFail && charDataForFail.status !== 'complete' && charDataForFail.status !== 'failed') {
                console.warn(`[Char ${charDataForFail.id}] Task ${taskId} fetch failed (${tripoResponse.status}), marking character as failed.`);
                await supabaseAdmin.from('characters').update({ status: 'failed' }).eq('id', charDataForFail.id);
            }
            return NextResponse.json({ error: errorMessage, status_code: tripoResponse.status }, { status: tripoResponse.status });
        }

        const tripoData = await tripoResponse.json();
        console.log(`[Task ${taskId}] Raw Tripo Status Data:`, tripoData);

        if (tripoData.code !== 0 || !tripoData.data) {
            console.error(`[Task ${taskId}] Invalid status response from Tripo:`, tripoData);
            // Attempt to mark character as failed
             const { data: charDataForFail } = await supabaseAdmin
                .from('characters')
                .select('id, status')
                .or(`tripo_model_task_id.eq.${taskId},tripo_rig_task_id.eq.${taskId}`)
                .maybeSingle();
            if (charDataForFail && charDataForFail.status !== 'complete' && charDataForFail.status !== 'failed') {
                console.warn(`[Char ${charDataForFail.id}] Invalid Tripo data for task ${taskId}, marking character as failed.`);
                await supabaseAdmin.from('characters').update({ status: 'failed' }).eq('id', charDataForFail.id);
            }
            throw new Error("Received invalid status data from Tripo3D.");
        }

        const tripoTaskDetails = tripoData.data; // Contains status, progress, type, output etc.

        // --- Fetch Character DB Status --- 
        let characterDbStatus: string | null = null;
        let characterDbId: string | null = null;

        const { data: charData, error: charError } = await supabaseAdmin
            .from('characters')
            .select('id, status')
            .or(`tripo_model_task_id.eq.${taskId},tripo_rig_task_id.eq.${taskId}`)
            .maybeSingle();

        if (charError) {
            console.warn(`[Task ${taskId}] Error fetching character status from DB:`, charError.message);
        } else if (charData) {
            characterDbId = charData.id;
            characterDbStatus = charData.status;
            console.log(`[Task ${taskId}] Found associated character ${characterDbId} with DB status: ${characterDbStatus}`);
        } else {
            console.log(`[Task ${taskId}] No character found linked to this task ID in DB yet.`);
        }

        // --- Handle Tripo Task State Changes --- 
        if (characterDbId && characterDbStatus !== 'complete' && characterDbStatus !== 'failed') {
            if (tripoTaskDetails.status === 'success' && tripoTaskDetails.type === 'animate_rig') {
                console.log(`[Task ${taskId}] Rigging task SUCCESSFUL according to Tripo.`);
                if (characterDbStatus !== 'saving_model') { // Avoid redundant updates
                    console.log(`[Char ${characterDbId}] DB status is '${characterDbStatus}'. Processing final model save...`);
                    const finalModelUrl = tripoTaskDetails.output?.model;
                    if (finalModelUrl && typeof finalModelUrl === 'string') {
                        console.log(`[Char ${characterDbId}] Updating DB status to 'saving_model'.`);
                        const { error: updateError } = await supabaseAdmin
                            .from('characters')
                            .update({ status: 'saving_model' })
                            .eq('id', characterDbId);
                        if (updateError) {
                             console.error(`[Char ${characterDbId}] Failed to update DB status to 'saving_model':`, updateError);
                             // Proceed to saveFinalModel anyway? Or mark as failed?
                             // Let's proceed for now, saveFinalModel will handle final status.
                        } else {
                            characterDbStatus = 'saving_model'; // Reflect immediate status change for the response
                        }
                        // Call async function (don't await)
                        saveFinalModel(characterDbId, finalModelUrl);
                    } else {
                        console.error(`[Char ${characterDbId}] Final model URL not found in successful rig task ${taskId} output:`, tripoTaskDetails.output);
                        await supabaseAdmin.from('characters').update({ status: 'failed' }).eq('id', characterDbId);
                        characterDbStatus = 'failed'; // Update status for the response
                    }
                } else {
                    console.log(`[Char ${characterDbId}] DB status is already 'saving_model'. saveFinalModel likely in progress.`);
                }
            } else if (tripoTaskDetails.status === 'failed' || tripoTaskDetails.status === 'error') {
                console.log(`[Task ${taskId}] Task FAILED according to Tripo (${tripoTaskDetails.status}).`);
                console.log(`[Char ${characterDbId}] Updating DB status to 'failed'.`);
                await supabaseAdmin.from('characters').update({ status: 'failed' }).eq('id', characterDbId);
                characterDbStatus = 'failed'; // Update status for the response
            }
            // Add handling for other Tripo statuses if needed to update DB (e.g., 'processing' -> 'generating_rig')
            
        } else if (characterDbId) {
             console.log(`[Char ${characterDbId}] Character DB status is '${characterDbStatus}'. No further DB updates needed based on Tripo task ${taskId}.`);
        }
        // --- End State Change Handling ---

        // Combine Tripo data with our potentially updated database status
        const responsePayload = {
            ...tripoTaskDetails, // Spread Tripo's data (status, progress, output, type, etc.)
            characterDatabaseStatus: characterDbStatus // Add our database status
        };

        console.log(`[Task ${taskId}] Sending response payload:`, responsePayload);
        return NextResponse.json(responsePayload, { status: 200 });

    } catch (error: any) {
        console.error(`[Task ${taskId}] Error in GET handler:`, error);
        // Try to mark associated character as failed if an unexpected error occurs
        // Find character ID again in catch block if needed (if error happened before charData assignment)
        const { data: charDataForFail } = await supabaseAdmin
            .from('characters')
            .select('id, status')
            .or(`tripo_model_task_id.eq.${taskId},tripo_rig_task_id.eq.${taskId}`)
            .maybeSingle();
        if (charDataForFail && charDataForFail.status !== 'complete' && charDataForFail.status !== 'failed') {
            console.warn(`[Char ${charDataForFail.id}] Unexpected error for task ${taskId}, marking character as failed.`);
            await supabaseAdmin.from('characters').update({ status: 'failed' }).eq('id', charDataForFail.id);
        }
        return NextResponse.json({ error: error.message || 'Failed to get task status' }, { status: 500 });
    }
} 