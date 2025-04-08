import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// --- Environment Variable Checks ---
if (!process.env.TRIPO_API_KEY) throw new Error("Missing TRIPO_API_KEY");
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

const TRIPO_API_KEY = process.env.TRIPO_API_KEY;

// --- Supabase Service Client --- 
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
);

interface RequestBody {
    modelTaskId: string; // The ID of the completed image-to-model task
    characterId: string; // Pass characterId to update the correct record
}

// POST function to handle /api/rig-character
export async function POST(request: NextRequest) {
    let requestBody: RequestBody;
    try {
        requestBody = await request.json();
    } catch (error) {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { modelTaskId, characterId } = requestBody;

    if (!modelTaskId || !characterId) {
        return NextResponse.json({ error: 'Missing modelTaskId or characterId' }, { status: 400 });
    }

    const url = 'https://api.tripo3d.ai/v2/openapi/task';
    const payload = {
        type: "animate_rig",
        original_model_task_id: modelTaskId,
        out_format: "glb" 
    };

    console.log(`Initiating Tripo rigging task for model task: ${modelTaskId} (Character: ${characterId})`);

    let riggingTaskId = '';
    try {
        // 1. Start Tripo Rigging Task
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${TRIPO_API_KEY}`
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Error creating Tripo3D rigging task: ${response.statusText} - ${errorText}`);
        }

        const data = await response.json();
        if (data.code !== 0 || !data.data?.task_id) {
            throw new Error("Failed to get task_id from Tripo3D rigging task creation.");
        }
        riggingTaskId = data.data.task_id;
        console.log("Tripo Rigging Task Created, ID:", riggingTaskId);

        // 2. Update Supabase record with rigging task ID and status
        console.log(`Updating character ${characterId} with rigging task ID ${riggingTaskId}...`);
        const { error: updateError } = await supabaseAdmin
            .from('characters')
            .update({ 
                tripo_rig_task_id: riggingTaskId,
                status: 'rigging' 
            })
            .eq('id', characterId);

        if (updateError) {
            console.error(`Supabase update error (rig task ID) for ${characterId}:`, updateError);
            // Log error but allow process to continue; client polling handles task status
        }
        
        // 3. Return the new rigging task ID
        return NextResponse.json({ riggingTaskId: riggingTaskId }, { status: 200 });

    } catch (error: any) {
        console.error(`Error creating rigging task for char ${characterId}:`, error);
        // Attempt to update status to 'failed' in Supabase if possible
        await supabaseAdmin.from('characters').update({ status: 'failed' }).eq('id', characterId);
        return NextResponse.json({ error: error.message || 'Failed to start rigging task' }, { status: 500 });
    }
} 